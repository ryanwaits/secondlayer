import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb, getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import type { LeaderBackend } from "@secondlayer/shared/leader";
import type { Kysely } from "kysely";
import type { SubgraphDefinition, SubgraphSchema } from "../types.ts";
import { startCatchUpLeader } from "./catchup-leader.ts";
import { catchUpSubgraph } from "./catchup.ts";
import { forgetRegistryReading } from "./chain-data-reader.ts";

/**
 * A trait-scoped subgraph resolves its contract set from the registry, which
 * classifies on a timer. Catch-up must not process a block above the height
 * the registry has classified through, or a matching contract deployed there
 * is unlabelled and its events are missed for good.
 */

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const BASE = 3_000_000;
const TIP = BASE + 150;
const UNCLASSIFIED_DEPLOY = BASE + 101;
const FAILED_DEPLOY = BASE + 120;
const CONTRACT = "SP9.registry-wait-token";
const FAILED_CONTRACT = "SP9.registry-wait-failed";
const HASH_PREFIX = "0xregwait";

let db: Kysely<Database>;
let stopLeader: () => Promise<void>;
let previousSeen: number | null = null;
const accountId = randomUUID();
const createdSubgraphNames: string[] = [];

function makeDef(name: string, trait: boolean): SubgraphDefinition {
	return {
		name,
		startBlock: BASE + 1,
		sources: trait
			? { transfers: { type: "ft_transfer", trait: "sip-010" } }
			: {},
		schema: {} as SubgraphSchema,
		handlers: {},
	} as unknown as SubgraphDefinition;
}

async function registerSubgraph(name: string, trait: boolean): Promise<void> {
	createdSubgraphNames.push(name);
	await db
		.insertInto("subgraphs")
		.values({
			name,
			status: "active",
			definition: makeDef(name, trait) as unknown as Record<string, unknown>,
			schema_hash: "test",
			handler_path: "test",
			schema_name: `sg_regwait_${name.replace(/-/g, "_")}`,
			account_id: accountId,
			start_block: BASE + 1,
		})
		.execute();
}

/** One catch-up tick against a fresh registry reading (the reader caches it
 *  for 15 s; these tests change the registry between ticks). */
async function catchUp(name: string, trait: boolean): Promise<void> {
	forgetRegistryReading(getSourceDb());
	await catchUpSubgraph(makeDef(name, trait), name);
}

async function cursorOf(name: string): Promise<number> {
	const row = await db
		.selectFrom("subgraphs")
		.select("last_processed_block")
		.where("name", "=", name)
		.executeTakeFirstOrThrow();
	return Number(row.last_processed_block);
}

async function deployTx(
	txId: string,
	height: number,
	contractId: string,
	status: string,
): Promise<void> {
	await db
		.insertInto("transactions")
		.values({
			tx_id: txId,
			block_height: height,
			tx_index: 0,
			type: "smart_contract",
			sender: "SP9",
			status,
			contract_id: contractId,
			raw_tx: "0x00",
		})
		.execute();
}

async function clearRegistryFixtures(): Promise<void> {
	await db
		.deleteFrom("contracts")
		.where("contract_id", "in", [CONTRACT, FAILED_CONTRACT])
		.execute();
	await db
		.deleteFrom("transactions")
		.where("tx_id", "like", `${HASH_PREFIX}%`)
		.execute();
}

beforeAll(async () => {
	db = getDb();
	const values = [];
	for (let h = BASE + 1; h <= TIP; h++) {
		values.push({
			height: h,
			hash: `${HASH_PREFIX}h${h}`,
			parent_hash: `${HASH_PREFIX}h${h - 1}`,
			burn_block_height: h,
			burn_block_hash: null,
			timestamp: 1_700_000_000 + h,
			canonical: true,
		});
	}
	await db.insertInto("blocks").values(values).execute();
	const network = process.env.NETWORK ?? "mainnet";
	const prior = await db
		.selectFrom("index_progress")
		.select("highest_seen_block")
		.where("network", "=", network)
		.executeTakeFirst();
	previousSeen = prior ? Number(prior.highest_seen_block) : null;
	await db
		.insertInto("index_progress")
		.values({ network, highest_seen_block: TIP })
		.onConflict((oc) =>
			oc.column("network").doUpdateSet({ highest_seen_block: TIP }),
		)
		.execute();
	const alwaysLeaderBackend = (): LeaderBackend => ({
		tryAcquire: async () => true,
		ping: async () => {},
		close: async () => {},
	});
	stopLeader = startCatchUpLeader({
		createBackend: alwaysLeaderBackend,
		pollMs: 10_000,
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
});

afterEach(clearRegistryFixtures);

afterAll(async () => {
	await stopLeader();
	for (const name of createdSubgraphNames) {
		await db.deleteFrom("subgraphs").where("name", "=", name).execute();
	}
	await clearRegistryFixtures();
	await db
		.deleteFrom("blocks")
		.where("hash", "like", `${HASH_PREFIX}%`)
		.execute();
	const network = process.env.NETWORK ?? "mainnet";
	if (previousSeen === null) {
		await db
			.deleteFrom("index_progress")
			.where("network", "=", network)
			.execute();
	} else {
		await db
			.updateTable("index_progress")
			.set({ highest_seen_block: previousSeen })
			.where("network", "=", network)
			.execute();
	}
});

describe("catch-up waits for the contract registry", () => {
	it("stops a trait subgraph just below a deploy the registry has not classified", async () => {
		await deployTx(
			`${HASH_PREFIX}-tx1`,
			UNCLASSIFIED_DEPLOY,
			CONTRACT,
			"success",
		);
		const name = `regwait-trait-${randomUUID().slice(0, 8)}`;
		await registerSubgraph(name, true);

		await catchUp(name, true);

		expect(await cursorOf(name)).toBe(UNCLASSIFIED_DEPLOY - 1);
	});

	it("resumes to the tip once the registry has classified the deploy", async () => {
		await deployTx(
			`${HASH_PREFIX}-tx1`,
			UNCLASSIFIED_DEPLOY,
			CONTRACT,
			"success",
		);
		const name = `regwait-resume-${randomUUID().slice(0, 8)}`;
		await registerSubgraph(name, true);
		await catchUp(name, true);
		expect(await cursorOf(name)).toBe(UNCLASSIFIED_DEPLOY - 1);

		await db
			.insertInto("contracts")
			.values({
				contract_id: CONTRACT,
				deployer: "SP9",
				block_height: UNCLASSIFIED_DEPLOY,
				canonical: true,
				abi_status: "fetched",
				inferred_standards: ["sip-010"],
			})
			.execute();
		await catchUp(name, true);

		expect(await cursorOf(name)).toBe(TIP);
	});

	it("is not blocked by a failed deploy transaction", async () => {
		await deployTx(
			`${HASH_PREFIX}-tx2`,
			FAILED_DEPLOY,
			FAILED_CONTRACT,
			"abort_by_response",
		);
		const name = `regwait-failed-${randomUUID().slice(0, 8)}`;
		await registerSubgraph(name, true);

		await catchUp(name, true);

		expect(await cursorOf(name)).toBe(TIP);
	});

	it("does not hold back a subgraph with no trait sources", async () => {
		await deployTx(
			`${HASH_PREFIX}-tx1`,
			UNCLASSIFIED_DEPLOY,
			CONTRACT,
			"success",
		);
		const name = `regwait-plain-${randomUUID().slice(0, 8)}`;
		await registerSubgraph(name, false);

		await catchUp(name, false);

		expect(await cursorOf(name)).toBe(TIP);
	});
});
