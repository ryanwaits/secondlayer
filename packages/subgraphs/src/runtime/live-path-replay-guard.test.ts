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
 * Plan f069: the live/catch-up path had no replay guard — `recordLiveProgress`
 * wrote `last_processed_block` unconditionally, and nothing stopped two
 * concurrent writers (a stale catch-up walker that lost its leader lease,
 * plus the new leader that took over) from both committing `ctx.increment`
 * deltas for overlapping heights. The f068 investigation
 * (`docs/internal/audits/asset-holdings-unreproducible-balances-f068.md`)
 * traced production's asset-holdings corruption to exactly this mechanism.
 *
 * These tests encode the invariants the fix establishes:
 *   1. Two concurrent `processBlock` calls for the SAME height can never both
 *      commit (the money test — this is what actually stops corruption).
 *   2/3. A laggard walker (behind the cursor) can never regress it, on both
 *      the normal write path and the matched=0 fast-return path.
 *   4. The reorg rewind is unaffected — it still needs to move the cursor
 *      *backward*, which the live path's conditional advance would refuse
 *      without the dedicated `reorgRewind` bypass.
 *   5. Losing the race is success-shaped: `skipped`, no thrown error, no
 *      "error" status flip.
 */

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const schema = {
	balances: {
		columns: {
			address: { type: "principal", indexed: true },
			balance: { type: "uint" },
		},
		uniqueKeys: [["address"]],
	},
} as unknown as SubgraphSchema;

/** Increment-based mint handler — mirrors the deployed accumulator shape
 *  (asset-holdings et al.) that this plan protects. */
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
function makeMintBlock(
	height: number,
	recipient: string,
	amount: string,
): PreloadedBlockData {
	txCounter++;
	const tx = {
		tx_id: `0xtx${height}_${txCounter}`,
		block_height: height,
		tx_index: 0,
		type: "contract_call",
		sender: recipient,
		status: "success",
		contract_id: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.t",
		function_name: "mint",
		function_args: null,
		raw_result: null,
		raw_tx: "0x00",
		created_at: new Date(0),
	} as Transaction;
	const event: Event = {
		id: randomUUID(),
		tx_id: tx.tx_id,
		block_height: height,
		event_index: 0,
		type: "ft_mint_event",
		data: {
			asset_identifier: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.t::t",
			amount,
			recipient,
		},
		created_at: new Date(0),
	} as Event;
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
		txs: [tx],
		events: [event],
	};
}

/** A block with no matching sources at all — the `matched.length === 0`
 *  fast-return path (`:409` in the plan). */
function makeEmptyBlock(height: number): PreloadedBlockData {
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
		txs: [],
		events: [],
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
	// Pre-create the journal table (rather than letting the first flush create
	// it lazily): in production the schema — journal included — exists long
	// before two walkers ever race on the same height, and concurrent
	// `CREATE TABLE IF NOT EXISTS` from two transactions racing to create it
	// for the first time is its own (unrelated) Postgres catalog race, not
	// the one this test is about.
	for (const stmt of emitJournalDDL(pgSchema)) {
		await sql.raw(stmt).execute(db);
	}
}

/** Register a managed, active subgraph with an explicit starting cursor. */
async function registerSubgraph(
	def: SubgraphDefinition,
	pgSchema: string,
	lastProcessedBlock: number,
): Promise<void> {
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
			last_processed_block: lastProcessedBlock,
		})
		.execute();
}

async function balanceOf(
	pgSchema: string,
	address: string,
): Promise<bigint | null> {
	const { rows } = await sql
		.raw(
			`SELECT balance FROM "${pgSchema}"."balances" WHERE address = '${address}'`,
		)
		.execute(db);
	const row = (rows as { balance: string }[])[0];
	return row ? BigInt(row.balance) : null;
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

beforeAll(() => {
	db = getDb();
});

afterAll(async () => {
	for (const name of createdSubgraphNames) {
		await db.deleteFrom("subgraphs").where("name", "=", name).execute();
	}
	for (const s of createdSchemas) {
		await sql.raw(`DROP SCHEMA IF EXISTS "${s}" CASCADE`).execute(db);
	}
});

describe("concurrent double-apply is impossible (the money test)", () => {
	it("two concurrent processBlock calls for the same height apply exactly once", async () => {
		const pgSchema = `sg_f069_money_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeMintDef(`f069-money-${randomUUID().slice(0, 8)}`);
		// Cursor starts two below the contested height, same as a real walk.
		await registerSubgraph(def, pgSchema, 998);

		const A = "SP1G48FZ4Y9SMP2C5HPRGQ8X9XQ7Y0Y9F9PMKQZ7H";
		// Seed an existing row for A first (uncontested) — this is the
		// production shape (asset-holdings' accumulator rows already exist by
		// the time a burst-window race hits them, not freshly created by the
		// racing block itself) and it keeps the assertion isolated to the
		// cursor-race guarantee: both racing UPDATEs below target the SAME
		// existing row, so ordinary Postgres row-level locking — not this
		// plan's guard — is what serializes the two writers' SQL; the guard is
		// what stops the LOSER's already-applied delta from being kept.
		const seed = await processBlock(def, def.name, 999, {
			preloaded: makeMintBlock(999, A, "1"),
		});
		expect(seed.skipped).toBe(false);
		expect(await balanceOf(pgSchema, A)).toBe(1n);

		const block = makeMintBlock(1000, A, "100");
		const [r1, r2] = await Promise.all([
			processBlock(def, def.name, 1000, { preloaded: block }),
			processBlock(def, def.name, 1000, { preloaded: block }),
		]);

		// Exactly one of the two committed; the other lost the cursor race.
		const skippedCount = [r1, r2].filter((r) => r.skipped).length;
		expect(skippedCount).toBe(1);

		// The money assertion: the +100 delta applied once, not twice.
		expect(await balanceOf(pgSchema, A)).toBe(101n);

		// The cursor landed at 1000 exactly once — not double-advanced, not left behind.
		expect((await subgraphRow(def.name)).last_processed_block).toBe(1000);
	});
});

describe("a laggard cannot regress the cursor", () => {
	it("processBlock at a height at/below the cursor is skipped and writes nothing", async () => {
		const pgSchema = `sg_f069_lag_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeMintDef(`f069-lag-${randomUUID().slice(0, 8)}`);
		await registerSubgraph(def, pgSchema, 5000);

		const A = "SP2TX6EG1TX6P1YXRRX1CBS7HK9GC9VPABPJ1E665";
		const result = await processBlock(def, def.name, 4990, {
			preloaded: makeMintBlock(4990, A, "999"),
		});

		expect(result.skipped).toBe(true);
		// f069: a skipped block must not inflate blocks_processed forensic stats.
		expect(result.timing).toBeUndefined();
		expect(await balanceOf(pgSchema, A)).toBeNull();
		expect((await subgraphRow(def.name)).last_processed_block).toBe(5000);
	});
});

describe("a matched=0 laggard cannot regress the cursor", () => {
	it("a no-op block below the cursor leaves last_processed_block untouched", async () => {
		const def = makeMintDef(`f069-lag0-${randomUUID().slice(0, 8)}`);
		// No data-plane schema needed — matchSources finds nothing for this
		// block, so this exercises the matched===0 out-of-tx call exclusively
		// (mirrors reorg-catchup-race.test.ts's isolation approach).
		createdSubgraphNames.push(def.name);
		await db
			.insertInto("subgraphs")
			.values({
				name: def.name,
				status: "active",
				definition: def as unknown as Record<string, unknown>,
				schema_hash: "test",
				handler_path: "test",
				schema_name: `sg_f069_lag0_${randomUUID().slice(0, 8)}`,
				account_id: accountId,
				last_processed_block: 5000,
			})
			.execute();

		const result = await processBlock(def, def.name, 4990, {
			preloaded: makeEmptyBlock(4990),
		});

		expect(result.matched).toBe(0);
		expect((await subgraphRow(def.name)).last_processed_block).toBe(5000);
	});
});

describe("reorg rewind still works", () => {
	it("moves the cursor backward, applies the fork block once, and live processing above it resumes", async () => {
		const pgSchema = `sg_f069_rewind_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeMintDef(`f069-rewind-${randomUUID().slice(0, 8)}`);
		await registerSubgraph(def, pgSchema, 0);

		const A = "SP3R9DNHRSBPT42JX98J92ZJHASWSBXT5ZW8X4XCK";

		// Advance to N=200 via ordinary live processing.
		await processBlock(def, def.name, 100, {
			preloaded: makeMintBlock(100, A, "10"),
		});
		await processBlock(def, def.name, 200, {
			preloaded: makeMintBlock(200, A, "20"),
		});
		expect((await subgraphRow(def.name)).last_processed_block).toBe(200);
		expect(await balanceOf(pgSchema, A)).toBe(30n);

		// Rewind to a fork at F=150 < N. Without reorgRewind mode, the live
		// guard would skip this (150 is at/below the current cursor, 200).
		const B = "SPKF5WM8Q5RZBZXCSBRZKW2X2YMA36CC1QHXRD0";
		const rewindResult = await processBlock(def, def.name, 150, {
			preloaded: makeMintBlock(150, B, "5"),
			reorgRewind: true,
		});
		expect(rewindResult.skipped).toBe(false);
		expect((await subgraphRow(def.name)).last_processed_block).toBe(150);
		// The fork block applied exactly once.
		expect(await balanceOf(pgSchema, B)).toBe(5n);

		// Live processing above the fork resumes normally (not skipped).
		const above = await processBlock(def, def.name, 151, {
			preloaded: makeMintBlock(151, B, "1"),
		});
		expect(above.skipped).toBe(false);
		expect((await subgraphRow(def.name)).last_processed_block).toBe(151);
		expect(await balanceOf(pgSchema, B)).toBe(6n);
	});
});

describe("race-loss is success-shaped", () => {
	it("the losing call reports skipped with no thrown error and no error status", async () => {
		const pgSchema = `sg_f069_shape_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeMintDef(`f069-shape-${randomUUID().slice(0, 8)}`);
		await registerSubgraph(def, pgSchema, 998);

		const A = "SP1AQDVJF18XEFVXMWTRAW9TQ0N2DCN0178FKW03R";
		// Seed an existing row first — see the money test above for why.
		await processBlock(def, def.name, 999, {
			preloaded: makeMintBlock(999, A, "1"),
		});
		const block = makeMintBlock(1000, A, "42");

		// Neither call may throw — processBlock itself converts the race loss
		// to `result.skipped`, never an unhandled rejection.
		const [r1, r2] = await Promise.all([
			processBlock(def, def.name, 1000, { preloaded: block }).catch((err) => {
				throw new Error(`processBlock must not throw: ${err}`);
			}),
			processBlock(def, def.name, 1000, { preloaded: block }).catch((err) => {
				throw new Error(`processBlock must not throw: ${err}`);
			}),
		]);

		const loser = r1.skipped ? r1 : r2;
		const winner = r1.skipped ? r2 : r1;
		expect(loser.skipped).toBe(true);
		expect(loser.errors).toBe(0);
		expect(winner.skipped).toBe(false);
		expect(winner.errors).toBe(0);

		// The subgraph's status reflects the winner's success, never flipped to
		// "error" by the loser's rolled-back transaction.
		expect((await subgraphRow(def.name)).status).toBe("active");
	});
});
