import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb, getRawClient } from "@secondlayer/shared/db";
import type { Subgraph } from "@secondlayer/shared/db";
import { createWebhook } from "@secondlayer/shared/db/queries/webhooks";
import { handleSubgraphReorg } from "../src/runtime/reorg.ts";
import { deploySchema } from "../src/schema/deployer.ts";
import type { SubgraphDefinition } from "../src/types.ts";

// Requires local Postgres via `bun run db` and migrations applied.
// Hosted contract: two webhooks may share a name across accounts.
// Pin platform so createWebhook keeps account_id (OSS writes "").
process.env.INSTANCE_MODE = "platform";
if (!process.env.SECONDLAYER_SECRETS_KEY) {
	process.env.SECONDLAYER_SECRETS_KEY = "a".repeat(64);
}

const SKIP = !process.env.DATABASE_URL;

const SUBGRAPH_NAME = "reorg-revert-outbox-test";
const PG_SCHEMA = "subgraph_reorg_revert_outbox_test";
const ACCOUNT_ID = "00000000-0000-0000-0000-000000000001";

const baseDef: SubgraphDefinition = {
	name: SUBGRAPH_NAME,
	version: "1.0.0",
	sources: { handler: { type: "contract_call", contractId: "SP123::test" } },
	schema: {
		transfers: {
			columns: {
				sender: { type: "principal" },
				amount: { type: "uint" },
			},
		},
	},
	handlers: { handler: async () => {} },
};

async function cleanup() {
	const db = getDb();
	const client = getRawClient();
	await client.unsafe(`DROP SCHEMA IF EXISTS "${PG_SCHEMA}" CASCADE`);
	await db
		.deleteFrom("webhook_outbox")
		.where("subgraph_name", "=", SUBGRAPH_NAME)
		.execute();
	await db
		.deleteFrom("webhooks")
		.where("subgraph_name", "=", SUBGRAPH_NAME)
		.execute();
	await db.deleteFrom("subgraphs").execute();
}

async function subscribe(name: string) {
	const { webhook } = await createWebhook(getDb(), {
		accountId: ACCOUNT_ID,
		name,
		subgraphName: SUBGRAPH_NAME,
		tableName: "transfers",
		url: "https://webhook.site/abc",
	});
	return webhook;
}

describe.skipIf(SKIP)("Reorg revert events reach the webhook outbox", () => {
	beforeAll(cleanup);
	afterEach(cleanup);
	afterAll(cleanup);

	test("a reverted row emits a .reverted outbox event for an active webhook", async () => {
		const db = getDb();
		const client = getRawClient();

		await deploySchema(db, baseDef, "/tmp/handler.ts");
		await subscribe("sub-1");

		await client.unsafe(`
			INSERT INTO ${PG_SCHEMA}.transfers ("_block_height", "_tx_id", "sender", "amount") VALUES
				(100, 'tx1', 'SP_A', 1000),
				(101, 'tx2', 'SP_B', 2000)
		`);

		const mockLoadDef = async (_sg: Subgraph) => baseDef;
		await handleSubgraphReorg(101, mockLoadDef);

		const outboxRows = await db
			.selectFrom("webhook_outbox")
			.selectAll()
			.where("subgraph_name", "=", SUBGRAPH_NAME)
			.execute();

		expect(outboxRows).toHaveLength(1);
		expect(outboxRows[0]?.event_type).toBe(
			`${SUBGRAPH_NAME}.transfers.reverted`,
		);
		expect(outboxRows[0]?.dedup_key).toBe(
			`reorg:${SUBGRAPH_NAME}:transfers:101`,
		);
	});

	test("replaying the same reorg height is a no-op — no duplicate outbox row, no throw", async () => {
		const db = getDb();
		const client = getRawClient();

		await deploySchema(db, baseDef, "/tmp/handler.ts");
		await subscribe("sub-1");

		await client.unsafe(`
			INSERT INTO ${PG_SCHEMA}.transfers ("_block_height", "_tx_id", "sender", "amount") VALUES
				(100, 'tx1', 'SP_A', 1000),
				(101, 'tx2', 'SP_B', 2000)
		`);

		const mockLoadDef = async (_sg: Subgraph) => baseDef;
		await handleSubgraphReorg(101, mockLoadDef);
		await expect(
			handleSubgraphReorg(101, mockLoadDef),
		).resolves.toBeUndefined();

		const outboxRows = await db
			.selectFrom("webhook_outbox")
			.selectAll()
			.where("subgraph_name", "=", SUBGRAPH_NAME)
			.execute();

		expect(outboxRows).toHaveLength(1);
	});

	test("two active webhooks on the same table each get their own outbox row sharing one dedup_key", async () => {
		const db = getDb();
		const client = getRawClient();

		await deploySchema(db, baseDef, "/tmp/handler.ts");
		await subscribe("sub-1");
		await subscribe("sub-2");

		await client.unsafe(`
			INSERT INTO ${PG_SCHEMA}.transfers ("_block_height", "_tx_id", "sender", "amount") VALUES
				(100, 'tx1', 'SP_A', 1000),
				(101, 'tx2', 'SP_B', 2000)
		`);

		const mockLoadDef = async (_sg: Subgraph) => baseDef;
		await handleSubgraphReorg(101, mockLoadDef);

		const outboxRows = await db
			.selectFrom("webhook_outbox")
			.selectAll()
			.where("subgraph_name", "=", SUBGRAPH_NAME)
			.execute();

		expect(outboxRows).toHaveLength(2);
		const dedupKeys = new Set(outboxRows.map((r) => r.dedup_key));
		expect(dedupKeys.size).toBe(1);
		expect([...dedupKeys][0]).toBe(`reorg:${SUBGRAPH_NAME}:transfers:101`);
		const webhookIds = new Set(outboxRows.map((r) => r.webhook_id));
		expect(webhookIds.size).toBe(2);
	});
});
