import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Database, Event, Subgraph } from "@secondlayer/shared/db";
import type { Transaction } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import { emitJournalDDL } from "../schema/generator.ts";
import type {
	SubgraphDefinition,
	SubgraphHandler,
	SubgraphSchema,
} from "../types.ts";
import type { PreloadedBlockData } from "./block-processor.ts";
import { processBlock } from "./block-processor.ts";
import type { SubgraphContext } from "./context.ts";
import { rewindMissedReorgs } from "./reorg-detect.ts";

/**
 * A processor that misses the `subgraph_reorg` NOTIFY (down, or not listening
 * yet) must still find the reorg on its next catch-up: every progress write
 * stores the hash of the block it reached, and a mismatch with the canonical
 * hash at the cursor rewinds the subgraph the way the NOTIFY would have.
 */

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const FIRST = 7_100_000;
const LAST = FIRST + 20;
const ASSET = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.t::t";
const ADDRESS = "SP1G48FZ4Y9SMP2C5HPRGQ8X9XQ7Y0Y9F9PMKQZ7H";

const schema = {
	balances: {
		columns: {
			address: { type: "principal", indexed: true },
			balance: { type: "uint" },
		},
		uniqueKeys: [["address"]],
	},
} as unknown as SubgraphSchema;

function makeDef(name: string): SubgraphDefinition {
	return {
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
			}) as unknown as SubgraphHandler,
		},
	};
}

const oldHash = (h: number) => `0xold${h}`;
const newHash = (h: number) => `0xnew${h}`;

function mintBlock(height: number): PreloadedBlockData {
	const tx = {
		tx_id: `0xtx${height}`,
		block_height: height,
		tx_index: 0,
		type: "contract_call",
		sender: ADDRESS,
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
		data: { asset_identifier: ASSET, amount: "1", recipient: ADDRESS },
		created_at: new Date(0),
	} as Event;
	return {
		block: {
			height,
			hash: oldHash(height),
			parent_hash: oldHash(height - 1),
			burn_block_height: height,
			burn_block_hash: null,
			index_block_hash: null,
			tx_count: null,
			event_count: null,
			timestamp: 1_700_000_000 + height,
			canonical: true,
			created_at: new Date(0),
		},
		txs: [tx],
		events: [event],
	};
}

let db: Kysely<Database>;
const createdSchemas: string[] = [];
const createdSubgraphNames: string[] = [];
const accountId = randomUUID();

async function seedCanonical(hash: (h: number) => string): Promise<void> {
	await db.deleteFrom("blocks").where("height", ">=", FIRST).execute();
	await db
		.deleteFrom("chain_reorgs")
		.where("fork_point_height", ">=", FIRST)
		.execute();
	await db
		.insertInto("blocks")
		.values(
			Array.from({ length: LAST - FIRST + 1 }, (_, i) => ({
				height: FIRST + i,
				hash: hash(FIRST + i),
				parent_hash: hash(FIRST + i - 1),
				burn_block_height: FIRST + i,
				burn_block_hash: null,
				timestamp: 1_700_000_000 + i,
				canonical: true,
			})),
		)
		.execute();
}

/** What the indexer does on a reorg: replacement blocks at and above the fork
 *  become canonical, and the fork unwinds one height at a time, so each orphaned
 *  height gets its own `chain_reorgs` row. */
async function reorgFrom(fork: number, orphanedTo: number): Promise<void> {
	await db
		.updateTable("blocks")
		.set({ hash: sql<string>`'0xnew' || height::text` })
		.where("height", ">=", fork)
		.where("height", "<=", LAST)
		.execute();
	await db
		.insertInto("chain_reorgs")
		.values(
			Array.from({ length: orphanedTo - fork + 1 }, (_, i) => ({
				fork_point_height: fork + i,
				old_index_block_hash: null,
				new_index_block_hash: null,
				orphaned_from_height: fork + i,
				orphaned_from_event_index: 0,
				orphaned_to_height: fork + i,
				orphaned_to_event_index: 0,
				new_canonical_height: LAST,
				new_canonical_event_index: 0,
			})),
		)
		.execute();
}

async function newSubgraph(): Promise<{
	def: SubgraphDefinition;
	pgSchema: string;
}> {
	const id = randomUUID().slice(0, 8);
	const pgSchema = `sg_rd_${id}`;
	createdSchemas.push(pgSchema);
	await sql.raw(`CREATE SCHEMA "${pgSchema}"`).execute(db);
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
	for (const stmt of emitJournalDDL(pgSchema)) await sql.raw(stmt).execute(db);
	const def = makeDef(`reorg-detect-${id}`);
	createdSubgraphNames.push(def.name);
	await db
		.insertInto("subgraphs")
		.values({
			name: def.name,
			status: "active",
			definition: def as unknown as Record<string, unknown>,
			schema_hash: "test",
			handler_path: "test",
			schema_name: pgSchema,
			account_id: accountId,
			last_processed_block: FIRST - 1,
		})
		.execute();
	return { def, pgSchema };
}

async function walk(def: SubgraphDefinition, from: number, to: number) {
	for (let h = from; h <= to; h++) {
		await processBlock(def, def.name, h, { preloaded: mintBlock(h) });
	}
}

async function balance(pgSchema: string): Promise<bigint | null> {
	const { rows } = await sql
		.raw(`SELECT balance FROM "${pgSchema}"."balances"`)
		.execute(db);
	const row = (rows as { balance: string }[])[0];
	return row ? BigInt(row.balance) : null;
}

async function row(name: string): Promise<Subgraph> {
	return db
		.selectFrom("subgraphs")
		.selectAll()
		.where("name", "=", name)
		.executeTakeFirstOrThrow();
}

beforeAll(async () => {
	db = getDb();
	await db
		.deleteFrom("chain_reorgs")
		.where("fork_point_height", ">=", FIRST)
		.execute();
});

afterAll(async () => {
	for (const name of createdSubgraphNames) {
		await db.deleteFrom("subgraphs").where("name", "=", name).execute();
	}
	for (const s of createdSchemas) {
		await sql.raw(`DROP SCHEMA IF EXISTS "${s}" CASCADE`).execute(db);
	}
	await db.deleteFrom("blocks").where("height", ">=", FIRST).execute();
	await db
		.deleteFrom("chain_reorgs")
		.where("fork_point_height", ">=", FIRST)
		.execute();
});

describe("a reorg the processor was not listening for", () => {
	it("is found on the next catch-up and rewinds rows back to the fork", async () => {
		await seedCanonical(oldHash);
		const { def, pgSchema } = await newSubgraph();
		await walk(def, FIRST, FIRST + 5);
		expect(await balance(pgSchema)).toBe(6n);
		expect((await row(def.name)).last_processed_block_hash).toBe(
			oldHash(FIRST + 5),
		);

		// The indexer reorgs from FIRST+3; no NOTIFY reaches the processor.
		await reorgFrom(FIRST + 3, FIRST + 5);
		await rewindMissedReorgs([await row(def.name)], async () => def);

		// Rows from the orphaned fork (FIRST+3..FIRST+5) are gone; the fork block
		// itself is reprocessed against the new chain, where it matches nothing.
		expect(await balance(pgSchema)).toBe(3n);
		const after = await row(def.name);
		expect(Number(after.last_processed_block)).toBe(FIRST + 3);
		expect(after.last_processed_block_hash).toBe(newHash(FIRST + 3));
	});

	it("leaves a subgraph alone while the canonical hash still matches", async () => {
		await seedCanonical(oldHash);
		const { def, pgSchema } = await newSubgraph();
		await walk(def, FIRST, FIRST + 4);

		await rewindMissedReorgs([await row(def.name)], async () => def);

		expect(await balance(pgSchema)).toBe(5n);
		expect(Number((await row(def.name)).last_processed_block)).toBe(FIRST + 4);
	});

	it("waits while the cursor height has no canonical block yet", async () => {
		await seedCanonical(oldHash);
		const { def, pgSchema } = await newSubgraph();
		await walk(def, FIRST, FIRST + 4);
		// Reorg committed, replacement block not stored yet.
		await db
			.updateTable("blocks")
			.set({ canonical: false })
			.where("height", ">=", FIRST + 2)
			.execute();

		await rewindMissedReorgs([await row(def.name)], async () => def);

		expect(await balance(pgSchema)).toBe(5n);
		expect(Number((await row(def.name)).last_processed_block)).toBe(FIRST + 4);
	});

	it("rewinds only the cursor block when no reorg record covers it", async () => {
		await seedCanonical(oldHash);
		const { def, pgSchema } = await newSubgraph();
		await walk(def, FIRST, FIRST + 4);
		await db
			.updateTable("blocks")
			.set({ hash: newHash(FIRST + 4) })
			.where("height", "=", FIRST + 4)
			.execute();

		await rewindMissedReorgs([await row(def.name)], async () => def);

		expect(await balance(pgSchema)).toBe(4n);
		expect(Number((await row(def.name)).last_processed_block)).toBe(FIRST + 4);
	});
});

describe("the stored block hash always names the block at the cursor", () => {
	it("is cleared when the cursor moves without a hash", async () => {
		await seedCanonical(oldHash);
		const { def } = await newSubgraph();
		await walk(def, FIRST, FIRST + 2);
		expect((await row(def.name)).last_processed_block_hash).toBe(
			oldHash(FIRST + 2),
		);

		// A reindex start / anchor seed moves the cursor and states no hash.
		await db
			.updateTable("subgraphs")
			.set({ last_processed_block: FIRST - 1 })
			.where("name", "=", def.name)
			.execute();

		expect((await row(def.name)).last_processed_block_hash).toBeNull();
	});

	it("keeps a hash written together with its cursor", async () => {
		await seedCanonical(oldHash);
		const { def } = await newSubgraph();
		await db
			.updateTable("subgraphs")
			.set({ last_processed_block: FIRST, last_processed_block_hash: "0xabc" })
			.where("name", "=", def.name)
			.execute();

		expect((await row(def.name)).last_processed_block_hash).toBe("0xabc");
	});

	it("an unknown hash is never treated as a reorg", async () => {
		await seedCanonical(oldHash);
		const { def, pgSchema } = await newSubgraph();
		await walk(def, FIRST, FIRST + 2);
		await db
			.updateTable("subgraphs")
			.set({ last_processed_block: FIRST + 1 })
			.where("name", "=", def.name)
			.execute();
		await reorgFrom(FIRST + 1, FIRST + 2);

		await rewindMissedReorgs([await row(def.name)], async () => def);

		expect(await balance(pgSchema)).toBe(3n);
	});
});
