import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Database, Event, Transaction } from "@secondlayer/shared/db";
import type { LeaderBackend } from "@secondlayer/shared/leader";
import type { Kysely } from "kysely";
import { emitJournalDDL } from "../schema/generator.ts";
import type {
	SubgraphDefinition,
	SubgraphHandler,
	SubgraphSchema,
} from "../types.ts";
import { type PreloadedBlockData, processBlock } from "./block-processor.ts";
import { startCatchUpLeader } from "./catchup-leader.ts";
import { catchUpSubgraph } from "./catchup.ts";
import type { SubgraphContext } from "./context.ts";

/**
 * A subgraph deleted and recreated under the same name gets a new id but the
 * same schema name. A block batch still in flight for the old row must not
 * move the new one: its cursor write, its rows and its walk all belong to the
 * old id.
 */

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";

const HAS_DB = !!process.env.DATABASE_URL;

// Own height range, clear of the other suites.
const BASE = 4_100_000;
const TOTAL_BLOCKS = 2000;
const FIRST_HEIGHT = BASE + 1;
const LAST_HEIGHT = BASE + TOTAL_BLOCKS;
const HASH_PREFIX = "0xrecreate441h";
const ASSET = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.t::t";
const RECIPIENT = "SP1G48FZ4Y9SMP2C5HPRGQ8X9XQ7Y0Y9F9PMKQZ7H";

const schema = {
	balances: {
		columns: {
			address: { type: "principal", indexed: true },
			balance: { type: "uint" },
		},
		uniqueKeys: [["address"]],
	},
} as unknown as SubgraphSchema;

let db: Kysely<Database>;
const accountId = randomUUID();
const createdSchemas: string[] = [];
const createdNames: string[] = [];
let previousSeen: number | null = null;
let stopLeader: () => Promise<void> = async () => {};

async function insertRow(
	name: string,
	pgSchema: string,
	cursor: number,
): Promise<string> {
	const row = await db
		.insertInto("subgraphs")
		.values({
			name,
			status: "active",
			definition: { name } as unknown as Record<string, unknown>,
			schema_hash: "test",
			handler_path: "test",
			schema_name: pgSchema,
			account_id: accountId,
			start_block: FIRST_HEIGHT,
			last_processed_block: cursor,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	return row.id;
}

/** What `deleteSubgraph` does to the registry, minus the schema drop (the
 *  in-flight transaction still holds locks on the tables in it). */
async function deleteAndRecreate(
	oldId: string,
	name: string,
	pgSchema: string,
	cursor: number,
): Promise<string> {
	await db.deleteFrom("subgraphs").where("id", "=", oldId).execute();
	return insertRow(name, pgSchema, cursor);
}

async function cursorOfId(id: string): Promise<number> {
	const row = await db
		.selectFrom("subgraphs")
		.select("last_processed_block")
		.where("id", "=", id)
		.executeTakeFirstOrThrow();
	return Number(row.last_processed_block);
}

function mintBlock(height: number): PreloadedBlockData {
	const tx = {
		tx_id: `0xrecreate441tx${height}`,
		block_height: height,
		tx_index: 0,
		type: "contract_call",
		sender: RECIPIENT,
		status: "success",
		contract_id: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.t",
		function_name: "mint",
		function_args: null,
		raw_result: null,
		raw_tx: "0x00",
		created_at: new Date(0),
	} as Transaction;
	const event = {
		id: randomUUID(),
		tx_id: tx.tx_id,
		block_height: height,
		event_index: 0,
		type: "ft_mint_event",
		data: { asset_identifier: ASSET, amount: "5", recipient: RECIPIENT },
		created_at: new Date(0),
	} as Event;
	return {
		block: {
			height,
			hash: `${HASH_PREFIX}${height}`,
			parent_hash: `${HASH_PREFIX}${height - 1}`,
			burn_block_height: height,
			burn_block_hash: null,
			index_block_hash: null,
			tx_count: null,
			event_count: null,
			timestamp: 1700000000 + height,
			canonical: true,
			created_at: new Date(0),
		},
		txs: [tx],
		events: [event],
	};
}

async function createBalancesTable(pgSchema: string): Promise<void> {
	createdSchemas.push(pgSchema);
	await sql.raw(`CREATE SCHEMA IF NOT EXISTS "${pgSchema}"`).execute(db);
	await sql
		.raw(
			`CREATE TABLE "${pgSchema}"."balances" (
				_id BIGSERIAL PRIMARY KEY,
				address TEXT NOT NULL,
				balance NUMERIC(78, 0),
				_block_height BIGINT NOT NULL,
				_tx_id TEXT NOT NULL,
				_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE (address)
			)`,
		)
		.execute(db);
	for (const stmt of emitJournalDDL(pgSchema)) {
		await sql.raw(stmt).execute(db);
	}
}

async function seedChain(): Promise<void> {
	await db
		.deleteFrom("blocks")
		.where("height", ">=", FIRST_HEIGHT)
		.where("height", "<=", LAST_HEIGHT)
		.where("hash", "not like", `${HASH_PREFIX}%`)
		.execute();
	const values = [];
	for (let h = FIRST_HEIGHT; h <= LAST_HEIGHT; h++) {
		values.push({
			height: h,
			hash: `${HASH_PREFIX}${h}`,
			parent_hash: `${HASH_PREFIX}${h - 1}`,
			burn_block_height: h + 900_000,
			burn_block_hash: null,
			timestamp: 1_700_000_000 + h,
			canonical: true,
		});
	}
	for (let i = 0; i < values.length; i += 500) {
		await db
			.insertInto("blocks")
			.values(values.slice(i, i + 500))
			.onConflict((oc) => oc.column("height").doNothing())
			.execute();
	}
	const network = process.env.NETWORK ?? "mainnet";
	const prior = await db
		.selectFrom("index_progress")
		.select("highest_seen_block")
		.where("network", "=", network)
		.executeTakeFirst();
	previousSeen = prior ? Number(prior.highest_seen_block) : null;
	await db
		.insertInto("index_progress")
		.values({ network, highest_seen_block: LAST_HEIGHT })
		.onConflict((oc) =>
			oc.column("network").doUpdateSet({ highest_seen_block: LAST_HEIGHT }),
		)
		.execute();
}

beforeAll(async () => {
	if (!HAS_DB) return;
	db = getDb();
	await seedChain();
	// Fake always-leader backend: catchUpSubgraph bails unless this process
	// holds the catch-up lease, and the lease is not what this test is about.
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

afterAll(async () => {
	if (!HAS_DB) return;
	await stopLeader();
	for (const name of createdNames) {
		await db.deleteFrom("subgraphs").where("name", "=", name).execute();
	}
	for (const s of createdSchemas) {
		await sql.raw(`DROP SCHEMA IF EXISTS "${s}" CASCADE`).execute(db);
	}
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

describe.skipIf(!HAS_DB)("delete and recreate under the same name", () => {
	it("a block in flight for the old subgraph neither moves the new cursor nor leaves rows", async () => {
		const name = `recreate-block-${randomUUID().slice(0, 8)}`;
		const pgSchema = `sg_recreate_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		createdNames.push(name);
		const oldId = await insertRow(name, pgSchema, BASE);
		let newId = "";

		const def: SubgraphDefinition = {
			name,
			startBlock: 1,
			sources: { mint: { type: "ft_mint", assetIdentifier: ASSET } },
			schema,
			handlers: {
				mint: (async (e: unknown, ctx: SubgraphContext) => {
					const ev = e as { recipient: string; amount: bigint };
					ctx.increment(
						"balances",
						{ address: ev.recipient },
						{ balance: ev.amount },
					);
					// Mid-batch: the subgraph is deleted and registered again.
					newId = await deleteAndRecreate(oldId, name, pgSchema, 0);
				}) as unknown as SubgraphHandler,
			},
		};

		const result = await processBlock(def, name, FIRST_HEIGHT, {
			preloaded: mintBlock(FIRST_HEIGHT),
			subgraphId: oldId,
		});

		expect(newId).not.toBe("");
		expect(result.skipped).toBe(true);
		expect(await cursorOfId(newId)).toBe(0);
		const { rows } = await sql<{ n: string }>`
			SELECT count(*)::text AS n FROM ${sql.raw(`"${pgSchema}"."balances"`)}
		`.execute(db);
		expect(rows[0]?.n).toBe("0");
	});

	it("a catch-up walk for the old subgraph stops instead of walking the new one", async () => {
		const name = `recreate-walk-${randomUUID().slice(0, 8)}`;
		const pgSchema = `sg_recreate_${randomUUID().slice(0, 8)}`;
		createdNames.push(name);
		const oldId = await insertRow(name, pgSchema, BASE);
		const def: SubgraphDefinition = {
			name,
			startBlock: FIRST_HEIGHT,
			sources: {},
			schema: {} as SubgraphSchema,
			handlers: {},
		};

		const walk = catchUpSubgraph(def, name, oldId);
		// Head start: the walk is mid-batch (2000 blocks of DB round trips).
		await new Promise((resolve) => setTimeout(resolve, 50));
		const newId = await deleteAndRecreate(oldId, name, pgSchema, BASE);
		const processed = await walk;

		expect(processed).toBeLessThan(TOTAL_BLOCKS);
		expect(await cursorOfId(newId)).toBe(BASE);
	});
});
