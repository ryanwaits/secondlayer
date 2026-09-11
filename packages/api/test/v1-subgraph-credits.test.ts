import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { resolve } from "node:path";
import {
	creditCredits,
	getCredits,
} from "@secondlayer/platform/db/queries/account-credits";
import { getDb, getRawClient } from "@secondlayer/shared/db";
import { registerSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
import { Hono } from "hono";
import { sql } from "kysely";
import { hashToken } from "../src/auth/keys.ts";
import { CREDIT_USD_MICROS_PER_ROW } from "../src/lib/read-credits.ts";
import { errorHandler } from "../src/middleware/error.ts";
import {
	startSubgraphCache,
	stopSubgraphCache,
} from "../src/routes/subgraphs.ts";
import v1SubgraphsRouter from "../src/routes/v1-subgraphs.ts";

// biome-ignore lint/suspicious/noExplicitAny: test JSON response typing
type Json = any;

const SKIP = !process.env.DATABASE_URL;

const SUBGRAPH_NAME = "test-v1-credits-subgraph";
const PG_SCHEMA = "subgraph_test_v1_credits_subgraph";
const START_BALANCE = 1_000_000n;

const subgraphDef = {
	name: SUBGRAPH_NAME,
	version: "1.0.0",
	definition: {
		name: SUBGRAPH_NAME,
		sources: [{ contract: "SP123::credits-fixture" }],
		schema: {
			items: {
				columns: {
					name: { type: "text" },
				},
			},
		},
	},
	schemaHash: "test-hash-v1-credits",
	handlerPath: resolve(__dirname, "../../../fixtures/test-handler.ts"),
};

describe.skipIf(SKIP)("/v1 subgraph table-read credits", () => {
	const savedMode = process.env.INSTANCE_MODE;
	const app = new Hono();
	app.onError(errorHandler);
	app.route("/v1/subgraphs", v1SubgraphsRouter);

	let accountId: string;
	let rawKey: string;
	const db = SKIP ? (null as never) : getDb();

	function authHeaders(): { authorization: string } {
		return { authorization: `Bearer ${rawKey}` };
	}

	beforeAll(async () => {
		process.env.INSTANCE_MODE = "platform";

		const account = await db
			.insertInto("accounts")
			.values({ email: null, ghost: true })
			.returning("id")
			.executeTakeFirstOrThrow();
		accountId = account.id;
		rawKey = `sk-sl_${crypto.randomUUID()}`;
		await db
			.insertInto("api_keys")
			.values({
				key_hash: hashToken(rawKey),
				key_prefix: "sk-sl_test",
				account_id: accountId,
				ip_address: "test",
				product: "account",
				tier: "free",
				status: "active",
			})
			.execute();
		await creditCredits(db, accountId, START_BALANCE);

		await db
			.deleteFrom("subgraphs")
			.where("name", "=", SUBGRAPH_NAME)
			.execute();
		await sql.raw(`DROP SCHEMA IF EXISTS ${PG_SCHEMA} CASCADE`).execute(db);

		await registerSubgraph(db, subgraphDef);
		await db
			.updateTable("subgraphs")
			.set({ visibility: "public" })
			.where("name", "=", SUBGRAPH_NAME)
			.execute();

		const client = getRawClient();
		await client.unsafe(`CREATE SCHEMA IF NOT EXISTS ${PG_SCHEMA}`);
		await client.unsafe(`
      CREATE TABLE IF NOT EXISTS ${PG_SCHEMA}.items (
        "_id" SERIAL PRIMARY KEY,
        "_block_height" BIGINT NOT NULL,
        "_tx_id" TEXT NOT NULL,
        "_created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "name" TEXT NOT NULL
      )
    `);
		await client.unsafe(`
      INSERT INTO ${PG_SCHEMA}.items ("_block_height", "_tx_id", "name")
      VALUES
        (100, 'tx1', 'alpha'),
        (100, 'tx2', 'beta'),
        (101, 'tx3', 'gamma')
    `);

		await startSubgraphCache();
	});

	afterEach(async () => {
		process.env.INSTANCE_MODE = "platform";
		await db
			.deleteFrom("account_credits")
			.where("account_id", "=", accountId)
			.execute();
		await creditCredits(db, accountId, START_BALANCE);
	});

	afterAll(async () => {
		await stopSubgraphCache();
		await sql.raw(`DROP SCHEMA IF EXISTS ${PG_SCHEMA} CASCADE`).execute(db);
		await db
			.deleteFrom("subgraphs")
			.where("name", "=", SUBGRAPH_NAME)
			.execute();
		await db
			.deleteFrom("api_keys")
			.where("account_id", "=", accountId)
			.execute();
		await db
			.deleteFrom("account_credits")
			.where("account_id", "=", accountId)
			.execute();
		await db.deleteFrom("accounts").where("id", "=", accountId).execute();
		if (savedMode === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = savedMode;
	});

	test("hosted anon GET is 401", async () => {
		const res = await app.request(`/v1/subgraphs/${SUBGRAPH_NAME}/items`);
		expect(res.status).toBe(401);
	});

	test("keyed credited list debits rows × standard rate", async () => {
		const res = await app.request(
			`/v1/subgraphs/${SUBGRAPH_NAME}/items?_limit=3`,
			{ headers: authHeaders() },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Json;
		expect(body.rows.length).toBe(3);
		const after = await getCredits(db, accountId);
		expect(after).toBe(
			START_BALANCE - BigInt(body.rows.length) * CREDIT_USD_MICROS_PER_ROW,
		);
	});

	test("empty page does not debit", async () => {
		const res = await app.request(
			`/v1/subgraphs/${SUBGRAPH_NAME}/items?cursor=999999`,
			{ headers: authHeaders() },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Json;
		expect(body.rows.length).toBe(0);
		expect(await getCredits(db, accountId)).toBe(START_BALANCE);
	});

	test("GET .../count does not debit", async () => {
		const res = await app.request(
			`/v1/subgraphs/${SUBGRAPH_NAME}/items/count`,
			{ headers: authHeaders() },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Json;
		expect(body.count).toBe(3);
		expect(await getCredits(db, accountId)).toBe(START_BALANCE);
	});

	test("GET .../:id 200 debits 1 row", async () => {
		const res = await app.request(`/v1/subgraphs/${SUBGRAPH_NAME}/items/1`, {
			headers: authHeaders(),
		});
		expect(res.status).toBe(200);
		expect(await getCredits(db, accountId)).toBe(
			START_BALANCE - CREDIT_USD_MICROS_PER_ROW,
		);
	});

	test("GET .../:id 404 does not debit", async () => {
		const res = await app.request(
			`/v1/subgraphs/${SUBGRAPH_NAME}/items/999999`,
			{ headers: authHeaders() },
		);
		expect(res.status).toBe(404);
		expect(await getCredits(db, accountId)).toBe(START_BALANCE);
	});
});
