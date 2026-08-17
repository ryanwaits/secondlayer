import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Database, Event, Transaction } from "@secondlayer/shared/db";
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

/**
 * fix-f084: a handler that threw on the live catch-up path had its writes
 * rolled back (runner.ts `ctx.rollbackTo`) but the cursor advanced past the
 * block anyway, and nothing recorded that the block's events were lost —
 * `subgraph_gaps` rows, the mechanism `/gaps` and backfill repair already
 * consume, were only ever written by the reindex/backfill path.
 *
 * These tests encode the invariants the fix establishes:
 *   1. A block where some (not all) handlers fail records exactly one gap
 *      row for that height, still advances the cursor, and stays "active".
 *   2. A block where every handler fails also records a gap row (on top of
 *      the existing "error" parking).
 *   3. A clean block (no handler errors) records no gap — the guard against
 *      gap spam on ordinary blocks.
 *   4. The gap write and the cursor advance are the same transaction: if the
 *      gap insert fails, the whole block rolls back, cursor included.
 *   5. The reorg rewind path never gains a gap write, even with errors.
 *   6. A lost cursor race (success-shaped, `LiveCursorRaceLostError`) is not
 *      a gap — it never has `errors > 0` to begin with.
 */

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";

const HAS_DB = !!process.env.DATABASE_URL;

const schema = {
	balances: {
		columns: {
			address: { type: "principal", indexed: true },
			balance: { type: "uint" },
		},
		uniqueKeys: [["address"]],
	},
} as unknown as SubgraphSchema;

/** Any recipient equal to this marker makes the handler throw — lets a test
 *  build a block with a mix of successful and failing matched events. */
const THROW_MARKER = "SP000000000000000000002Q6VF78";

/** Increment-based mint handler — mirrors the deployed accumulator shape,
 *  with a synthetic failure hook keyed off the recipient address. */
function makeMintDef(name: string): SubgraphDefinition {
	return {
		name,
		startBlock: 1,
		sources: {
			mint: {
				type: "ft_mint",
				assetIdentifier: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.t::t",
			},
		},
		schema,
		handlers: {
			mint: (async (e: unknown, ctx: SubgraphContext) => {
				const ev = e as { recipient: string; amount: bigint };
				if (ev.recipient === THROW_MARKER) {
					throw new Error("synthetic handler failure");
				}
				ctx.increment(
					"balances",
					{ address: ev.recipient },
					{ balance: ev.amount },
				);
			}) as unknown as SubgraphHandler,
		},
	};
}

let txCounter = 0;

/** A block carrying one or more ft_mint events, one tx+event pair per entry. */
function makeMintBlock(
	height: number,
	entries: { recipient: string; amount: string }[],
): PreloadedBlockData {
	const txs: Transaction[] = [];
	const events: Event[] = [];
	entries.forEach((entry, i) => {
		txCounter++;
		const tx = {
			tx_id: `0xtx${height}_${txCounter}`,
			block_height: height,
			tx_index: i,
			type: "contract_call",
			sender: entry.recipient,
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
			event_index: i,
			type: "ft_mint_event",
			data: {
				asset_identifier: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.t::t",
				amount: entry.amount,
				recipient: entry.recipient,
			},
			created_at: new Date(0),
		} as Event;
		txs.push(tx);
		events.push(event);
	});
	return {
		block: {
			height,
			hash: `0xblock${height}`,
			parent_hash: `0xblock${height - 1}`,
			burn_block_height: height,
			burn_block_hash: null,
			index_block_hash: null,
			timestamp: 1700000000 + height,
			canonical: true,
			created_at: new Date(0),
		},
		txs,
		events,
	};
}

let db: Kysely<Database>;
const createdSchemas: string[] = [];
const createdSubgraphNames: string[] = [];
const accountId = randomUUID();

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

/** Register a managed, active subgraph with an explicit starting cursor, and
 *  return its row id — needed to pass `subgraphId` into `processBlock`. */
async function registerSubgraph(
	def: SubgraphDefinition,
	pgSchema: string,
	lastProcessedBlock: number,
): Promise<string> {
	createdSubgraphNames.push(def.name);
	const row = await db
		.insertInto("subgraphs")
		.values({
			name: def.name,
			status: "active",
			definition: def as unknown as Record<string, unknown>,
			schema_hash: "test",
			handler_path: "test",
			schema_name: pgSchema,
			account_id: accountId,
			last_processed_block: lastProcessedBlock,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	return row.id;
}

async function subgraphRow(
	name: string,
): Promise<{ last_processed_block: number; status: string }> {
	const row = await db
		.selectFrom("subgraphs")
		.select(["last_processed_block", "status"])
		.where("name", "=", name)
		.executeTakeFirstOrThrow();
	return {
		last_processed_block: Number(row.last_processed_block),
		status: row.status,
	};
}

async function gapsFor(
	name: string,
): Promise<{ gap_start: number; gap_end: number; reason: string }[]> {
	const rows = await db
		.selectFrom("subgraph_gaps")
		.select(["gap_start", "gap_end", "reason"])
		.where("subgraph_name", "=", name)
		.execute();
	return rows.map((r) => ({
		gap_start: Number(r.gap_start),
		gap_end: Number(r.gap_end),
		reason: r.reason,
	}));
}

beforeAll(() => {
	if (!HAS_DB) return;
	db = getDb();
});

afterAll(async () => {
	if (!HAS_DB) return;
	for (const name of createdSubgraphNames) {
		// Cascades to subgraph_gaps (ON DELETE CASCADE, migration 0018).
		await db.deleteFrom("subgraphs").where("name", "=", name).execute();
	}
	for (const s of createdSchemas) {
		await sql.raw(`DROP SCHEMA IF EXISTS "${s}" CASCADE`).execute(db);
	}
});

describe.skipIf(!HAS_DB)("live path errors record a gap (fix-f084)", () => {
	it("a partial failure records exactly one gap row, advances the cursor, and stays active", async () => {
		const pgSchema = `sg_f084_partial_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeMintDef(`f084-partial-${randomUUID().slice(0, 8)}`);
		const subgraphId = await registerSubgraph(def, pgSchema, 999);

		const ok = "SP1G48FZ4Y9SMP2C5HPRGQ8X9XQ7Y0Y9F9PMKQZ7H";
		const block = makeMintBlock(1000, [
			{ recipient: ok, amount: "5" },
			{ recipient: THROW_MARKER, amount: "1" },
		]);

		const result = await processBlock(def, def.name, 1000, {
			preloaded: block,
			subgraphId,
		});

		expect(result.processed).toBe(1);
		expect(result.errors).toBe(1);

		const gaps = await gapsFor(def.name);
		expect(gaps.length).toBe(1);
		expect(gaps[0]).toEqual({
			gap_start: 1000,
			gap_end: 1000,
			reason: "processing_error",
		});

		const row = await subgraphRow(def.name);
		expect(row.last_processed_block).toBe(1000);
		expect(row.status).toBe("active");
	});

	it("a total failure records a gap row and parks the subgraph in error", async () => {
		const pgSchema = `sg_f084_total_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeMintDef(`f084-total-${randomUUID().slice(0, 8)}`);
		const subgraphId = await registerSubgraph(def, pgSchema, 999);

		const block = makeMintBlock(1000, [
			{ recipient: THROW_MARKER, amount: "1" },
		]);

		const result = await processBlock(def, def.name, 1000, {
			preloaded: block,
			subgraphId,
		});

		expect(result.processed).toBe(0);
		expect(result.errors).toBe(1);

		const gaps = await gapsFor(def.name);
		expect(gaps.length).toBe(1);
		expect(gaps[0]).toEqual({
			gap_start: 1000,
			gap_end: 1000,
			reason: "processing_error",
		});

		const row = await subgraphRow(def.name);
		expect(row.status).toBe("error");
	});

	it("a clean block records no gap", async () => {
		const pgSchema = `sg_f084_clean_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeMintDef(`f084-clean-${randomUUID().slice(0, 8)}`);
		const subgraphId = await registerSubgraph(def, pgSchema, 999);

		const ok = "SP2TX6EG1TX6P1YXRRX1CBS7HK9GC9VPABPJ1E665";
		const block = makeMintBlock(1000, [{ recipient: ok, amount: "7" }]);

		const result = await processBlock(def, def.name, 1000, {
			preloaded: block,
			subgraphId,
		});

		expect(result.errors).toBe(0);
		expect(await gapsFor(def.name)).toEqual([]);
	});

	it("if the gap insert fails, the whole block rolls back — cursor included", async () => {
		const pgSchema = `sg_f084_atomic_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeMintDef(`f084-atomic-${randomUUID().slice(0, 8)}`);
		await registerSubgraph(def, pgSchema, 999);

		const block = makeMintBlock(1000, [
			{ recipient: THROW_MARKER, amount: "1" },
		]);

		// A subgraphId that does not exist in `subgraphs` — recordGapBatch's
		// insert violates subgraph_gaps.subgraph_id's FK (migration 0018),
		// which must fail the whole block transaction rather than commit a
		// cursor advance with no gap to show for it.
		const bogusSubgraphId = randomUUID();

		await expect(
			processBlock(def, def.name, 1000, {
				preloaded: block,
				subgraphId: bogusSubgraphId,
			}),
		).rejects.toThrow();

		const row = await subgraphRow(def.name);
		expect(row.last_processed_block).toBe(999);
		expect(row.status).toBe("active");
		expect(await gapsFor(def.name)).toEqual([]);
	});

	it("a reorg rewind with errors records no gap", async () => {
		const pgSchema = `sg_f084_rewind_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeMintDef(`f084-rewind-${randomUUID().slice(0, 8)}`);
		const subgraphId = await registerSubgraph(def, pgSchema, 2000);

		const block = makeMintBlock(1500, [
			{ recipient: THROW_MARKER, amount: "1" },
		]);

		const result = await processBlock(def, def.name, 1500, {
			preloaded: block,
			subgraphId,
			reorgRewind: true,
		});

		expect(result.errors).toBe(1);
		expect(await gapsFor(def.name)).toEqual([]);
	});

	it("a lost cursor race is not a gap", async () => {
		const pgSchema = `sg_f084_race_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeMintDef(`f084-race-${randomUUID().slice(0, 8)}`);
		const subgraphId = await registerSubgraph(def, pgSchema, 998);

		const A = "SP3R9DNHRSBPT42JX98J92ZJHASWSBXT5ZW8X4XCK";
		// Seed an existing row first (matches production shape — both racing
		// writes below target an existing row, so ordinary row locking
		// serializes them, not this test's assertion).
		await processBlock(def, def.name, 999, {
			preloaded: makeMintBlock(999, [{ recipient: A, amount: "1" }]),
			subgraphId,
		});

		const block = makeMintBlock(1000, [{ recipient: A, amount: "10" }]);
		const [r1, r2] = await Promise.all([
			processBlock(def, def.name, 1000, { preloaded: block, subgraphId }),
			processBlock(def, def.name, 1000, { preloaded: block, subgraphId }),
		]);

		const loser = r1.skipped ? r1 : r2;
		expect(loser.skipped).toBe(true);
		expect(loser.errors).toBe(0);
		expect(await gapsFor(def.name)).toEqual([]);
	});
});
