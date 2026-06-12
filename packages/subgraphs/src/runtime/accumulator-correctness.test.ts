import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Database, Event, Transaction } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import { generateSubgraphSQL } from "../schema/generator.ts";
import type {
	ComputedValue,
	SubgraphDefinition,
	SubgraphHandler,
	SubgraphSchema,
} from "../types.ts";
import type { PreloadedBlockData } from "./block-processor.ts";
import { processBlock } from "./block-processor.ts";
import { SubgraphContext } from "./context.ts";
import { handleSubgraphReorg } from "./reorg.ts";

/**
 * Sprint 0 of plans/fix-f040-subgraph-accumulator-correctness.md.
 *
 * Encodes the correctness invariants an accumulator subgraph (running
 * balance via patchOrInsert functional updaters) must satisfy. All three
 * groups FAIL on current code by design — Sprints 1-3 make them green:
 *
 *   B1 (Sprint 1): in-block reads must see pending same-block writes;
 *       same-key flush must not collapse deltas last-write-wins.
 *   B3 (Sprint 2): reprocessing an already-processed block must not
 *       change accumulator state (crash-replay idempotency).
 *   B2 (Sprint 3): a reorg must revert only post-fork deltas, never
 *       wipe a row's genesis-accumulated value.
 *
 * Prod ground truth (2026-06-11): keeper SP3R9...keeper-4-grp07zcnf-v-1-1
 * has exactly 2 credit + 2 debit sBTC events (net 0), stored balance
 * -1489763 — both credits dropped by stale-read + last-write-wins.
 */

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const ASSET =
	"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token";
const POOL = "SP3XXMS38VTAWTVPE5682XSBFXPTH7XCPEBTX8AN2.pool";
const KEEPER =
	"SP3R9DNHRSBPT42JX98J92ZJHASWSBXT5ZW8X4XCK.keeper-4-grp07zcnf-v-1-1";
const SINK = "SPKF5WM8Q5RZBZXCSBRZKW2X2YMA36CC1QHXRD0";

const schema = {
	balances: {
		columns: {
			address: { type: "principal", indexed: true },
			balance: { type: "uint" },
		},
		uniqueKeys: [["address"]],
	},
} as unknown as SubgraphSchema;

type BalanceRow = { balance?: string | number | bigint };
const toBig = (v: string | number | bigint | undefined) => BigInt(v ?? 0);

/** Mirrors scripts/seed-balances/sbtc-balances.ts handlers exactly. */
function makeHandlers(): Record<string, SubgraphHandler> {
	const credit = async (
		ctx: SubgraphContext,
		address: string,
		amount: bigint,
	) => {
		await ctx.patchOrInsert(
			"balances",
			{ address },
			{
				address,
				balance: ((existing: BalanceRow | null) =>
					toBig(existing?.balance) + amount) as ComputedValue,
			},
		);
	};
	const debit = async (
		ctx: SubgraphContext,
		address: string,
		amount: bigint,
	) => {
		await ctx.patchOrInsert(
			"balances",
			{ address },
			{
				address,
				balance: ((existing: BalanceRow | null) =>
					toBig(existing?.balance) - amount) as ComputedValue,
			},
		);
	};
	return {
		transfer: (async (e: unknown, ctx: SubgraphContext) => {
			const ev = e as { sender: string; recipient: string; amount: bigint };
			await debit(ctx, ev.sender, ev.amount);
			await credit(ctx, ev.recipient, ev.amount);
		}) as SubgraphHandler,
		mint: (async (e: unknown, ctx: SubgraphContext) => {
			const ev = e as { recipient: string; amount: bigint };
			await credit(ctx, ev.recipient, ev.amount);
		}) as SubgraphHandler,
		burn: (async (e: unknown, ctx: SubgraphContext) => {
			const ev = e as { sender: string; amount: bigint };
			await debit(ctx, ev.sender, ev.amount);
		}) as SubgraphHandler,
	};
}

function makeDef(name: string): SubgraphDefinition {
	return {
		name,
		startBlock: 1,
		sources: {
			transfer: { type: "ft_transfer", assetIdentifier: ASSET },
			mint: { type: "ft_mint", assetIdentifier: ASSET },
			burn: { type: "ft_burn", assetIdentifier: ASSET },
		},
		schema,
		handlers: makeHandlers(),
	};
}

/** Same subgraph but with ctx.increment handlers — mirrors the migrated
 *  scripts/seed-balances defs. */
function makeIncrementDef(name: string): SubgraphDefinition {
	return {
		...makeDef(name),
		name,
		handlers: {
			transfer: (async (e: unknown, ctx: SubgraphContext) => {
				const ev = e as { sender: string; recipient: string; amount: bigint };
				ctx.increment(
					"balances",
					{ address: ev.sender },
					{ balance: -ev.amount },
				);
				ctx.increment(
					"balances",
					{ address: ev.recipient },
					{ balance: ev.amount },
				);
			}) as SubgraphHandler,
			mint: (async (e: unknown, ctx: SubgraphContext) => {
				const ev = e as { recipient: string; amount: bigint };
				ctx.increment(
					"balances",
					{ address: ev.recipient },
					{ balance: ev.amount },
				);
			}) as SubgraphHandler,
			burn: (async (e: unknown, ctx: SubgraphContext) => {
				const ev = e as { sender: string; amount: bigint };
				ctx.increment(
					"balances",
					{ address: ev.sender },
					{ balance: -ev.amount },
				);
			}) as SubgraphHandler,
		},
	};
}

// --- Fixtures: preloaded block data (bypasses blocks/events table reads) ---

let txCounter = 0;

function makeTx(blockHeight: number): Transaction {
	txCounter++;
	return {
		tx_id: `0xtx${blockHeight}_${txCounter}`,
		block_height: blockHeight,
		tx_index: 0,
		type: "contract_call",
		sender: POOL,
		status: "success",
		contract_id: POOL,
		function_name: "execute",
		function_args: null,
		raw_result: null,
		raw_tx: "0x00",
		created_at: new Date(0),
	} as Transaction;
}

type FtEvent =
	| { kind: "transfer"; sender: string; recipient: string; amount: string }
	| { kind: "mint"; recipient: string; amount: string }
	| { kind: "burn"; sender: string; amount: string };

function makeBlock(height: number, ftEvents: FtEvent[]): PreloadedBlockData {
	const tx = makeTx(height);
	const events: Event[] = ftEvents.map((e, i) => {
		const data: Record<string, unknown> = {
			asset_identifier: ASSET,
			amount: e.amount,
		};
		if ("sender" in e) data.sender = e.sender;
		if ("recipient" in e) data.recipient = e.recipient;
		return {
			id: randomUUID(),
			tx_id: tx.tx_id,
			block_height: height,
			event_index: i,
			type: `ft_${e.kind}_event`,
			data,
			created_at: new Date(0),
		} as Event;
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
		txs: [tx],
		events,
	};
}

// --- DB setup ---

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
}

/** Register a managed subgraph so processBlock/reorg see it (status active). */
async function registerSubgraph(
	def: SubgraphDefinition,
	pgSchema: string,
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

// ---------------------------------------------------------------------------
// B1 — intra-block lost update (root cause; fixed in Sprint 1)
// ---------------------------------------------------------------------------

describe("same-block events on one row all apply (no lost updates)", () => {
	it("receive-then-forward in one block nets to zero", async () => {
		const pgSchema = `sg_acc_b1a_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeDef(`acc-b1a-${randomUUID().slice(0, 8)}`);
		await registerSubgraph(def, pgSchema);

		const block = makeBlock(1000, [
			{ kind: "transfer", sender: POOL, recipient: KEEPER, amount: "501200" },
			{ kind: "transfer", sender: KEEPER, recipient: SINK, amount: "501200" },
		]);
		const result = await processBlock(def, def.name, 1000, {
			preloaded: block,
		});
		expect(result.errors).toBe(0);
		expect(result.processed).toBe(2);

		// Keeper received 501200 and forwarded 501200 → 0. Current code: the
		// debit's stale read + last-write-wins flush discards the credit → -501200.
		expect(await balanceOf(pgSchema, KEEPER)).toBe(0n);
		expect(await balanceOf(pgSchema, SINK)).toBe(501200n);
		// Pool started untracked: 0 - 501200.  (Negative here is the *handler's*
		// semantics for an untracked sender — fine for this invariant test.)
		expect(await balanceOf(pgSchema, POOL)).toBe(-501200n);
	});

	it("reproduces the prod keeper sequence exactly: two flash cycles → 0, not -1489763", async () => {
		const pgSchema = `sg_acc_b1b_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeDef(`acc-b1b-${randomUUID().slice(0, 8)}`);
		await registerSubgraph(def, pgSchema);

		// Block 1239443: pool → keeper 501200, keeper → sink 501200 (same tx)
		await processBlock(def, def.name, 1239443, {
			preloaded: makeBlock(1239443, [
				{ kind: "transfer", sender: POOL, recipient: KEEPER, amount: "501200" },
				{ kind: "transfer", sender: KEEPER, recipient: SINK, amount: "501200" },
			]),
		});
		// Block 1280400: pool → keeper 988563, keeper → sink 988563 (same tx)
		await processBlock(def, def.name, 1280400, {
			preloaded: makeBlock(1280400, [
				{ kind: "transfer", sender: POOL, recipient: KEEPER, amount: "988563" },
				{ kind: "transfer", sender: KEEPER, recipient: SINK, amount: "988563" },
			]),
		});

		// Ground truth: 0. Current code stores exactly -1489763 (prod value).
		expect(await balanceOf(pgSchema, KEEPER)).toBe(0n);
		expect(await balanceOf(pgSchema, SINK)).toBe(1489763n);
	});

	it("mint + transfer touching one address in one block both apply", async () => {
		const pgSchema = `sg_acc_b1c_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeDef(`acc-b1c-${randomUUID().slice(0, 8)}`);
		await registerSubgraph(def, pgSchema);

		const A = "SP000000000000000000002Q6VF78";
		const B = "SP1P72Z3704VMT3DMHPP2CB8TGQWGDBHD3RPR9GZS";
		const block = makeBlock(2000, [
			{ kind: "mint", recipient: A, amount: "100" },
			{ kind: "transfer", sender: A, recipient: B, amount: "40" },
		]);
		await processBlock(def, def.name, 2000, { preloaded: block });

		// Current code: dispatch is source-grouped (all transfers, then mints),
		// so A's last-write-wins value is the mint's stale-read +100 — the
		// transfer debit is discarded. Correct: 100 - 40 = 60.
		expect(await balanceOf(pgSchema, A)).toBe(60n);
		expect(await balanceOf(pgSchema, B)).toBe(40n);
	});

	it("context-level: patchOrInsert reads must observe pending same-block writes", async () => {
		const pgSchema = `sg_acc_b1d_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);

		const ctx = new SubgraphContext(
			db,
			pgSchema,
			schema,
			{ height: 10, hash: "0xa", timestamp: 1, burnBlockHeight: 1 },
			{ txId: "0x1", sender: POOL, type: "contract_call", status: "success" },
		);

		await ctx.patchOrInsert(
			"balances",
			{ address: KEEPER },
			{
				address: KEEPER,
				balance: ((e: BalanceRow | null) =>
					toBig(e?.balance) + 500n) as ComputedValue,
			},
		);
		await ctx.patchOrInsert(
			"balances",
			{ address: KEEPER },
			{
				address: KEEPER,
				balance: ((e: BalanceRow | null) =>
					toBig(e?.balance) - 500n) as ComputedValue,
			},
		);
		await ctx.flush();

		// +500 then -500 → 0. Current code: second read sees pre-block NULL,
		// computes -500, last-write-wins keeps -500.
		expect(await balanceOf(pgSchema, KEEPER)).toBe(0n);
	});
});

// ---------------------------------------------------------------------------
// B3 — crash-replay idempotency (fixed in Sprint 2: atomic checkpoint + skip)
// ---------------------------------------------------------------------------

describe("reprocessing a block never double-applies deltas", () => {
	// Mirrors the exact options the reindex walk passes (reindex.ts).
	const reindexOpts = {
		skipProgressUpdate: true,
		atomicProgress: { status: "reindexing" },
	};

	it("reprocessing an already-processed block leaves accumulator state unchanged", async () => {
		const pgSchema = `sg_acc_b3_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeDef(`acc-b3-${randomUUID().slice(0, 8)}`);
		await registerSubgraph(def, pgSchema);

		const A = "SP2TX6EG1TX6P1YXRRX1CBS7HK9GC9VPABPJ1E665";
		const block = makeBlock(3000, [
			{ kind: "mint", recipient: A, amount: "100" },
		]);

		const first = await processBlock(def, def.name, 3000, {
			...reindexOpts,
			preloaded: block,
		});
		expect(first.skipped).toBe(false);
		expect(await balanceOf(pgSchema, A)).toBe(100n);

		// Crash-replay: same block again must be skipped via the checkpoint
		// committed with the first pass's writes.
		const replay = await processBlock(def, def.name, 3000, {
			...reindexOpts,
			preloaded: block,
		});
		expect(replay.skipped).toBe(true);
		expect(await balanceOf(pgSchema, A)).toBe(100n);
	});

	it("a block that writes rows must atomically advance the checkpoint", async () => {
		const pgSchema = `sg_acc_b3b_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeDef(`acc-b3b-${randomUUID().slice(0, 8)}`);
		await registerSubgraph(def, pgSchema);

		const A = "SP2TX6EG1TX6P1YXRRX1CBS7HK9GC9VPABPJ1E665";
		await processBlock(def, def.name, 4000, {
			...reindexOpts,
			preloaded: makeBlock(4000, [{ kind: "mint", recipient: A, amount: "7" }]),
		});

		// If rows were written for block 4000, last_processed_block must be
		// >= 4000 in the same commit — otherwise a crash here replays the block
		// (non-idempotently) on resume.
		const row = await db
			.selectFrom("subgraphs")
			.select("last_processed_block")
			.where("name", "=", def.name)
			.executeTakeFirstOrThrow();
		expect(Number(row.last_processed_block)).toBeGreaterThanOrEqual(4000);
	});

	it("a no-write block does not advance the atomic checkpoint (batched progress covers it)", async () => {
		const pgSchema = `sg_acc_b3c_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeDef(`acc-b3c-${randomUUID().slice(0, 8)}`);
		await registerSubgraph(def, pgSchema);

		// Block with no matching events → no writes → checkpoint untouched
		// (replaying a no-op block is harmless, so lag is fine here).
		await processBlock(def, def.name, 5000, {
			...reindexOpts,
			preloaded: makeBlock(5000, []),
		});
		const row = await db
			.selectFrom("subgraphs")
			.select("last_processed_block")
			.where("name", "=", def.name)
			.executeTakeFirstOrThrow();
		expect(Number(row.last_processed_block)).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// B2 — reorg must not wipe accumulated state (fixed in Sprint 3: revert journal)
// ---------------------------------------------------------------------------

describe("reorg reverts orphaned deltas without destroying balances", () => {
	it("preserves pre-fork accumulated balance when a post-fork block is reorged", async () => {
		const pgSchema = `sg_acc_b2_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeDef(`acc-b2-${randomUUID().slice(0, 8)}`);
		await registerSubgraph(def, pgSchema);

		const A = "SP1G48FZ4Y9SMP2C5HPRGQ8X9XQ7Y0Y9F9PMKQZ7H";

		// Accumulate across two blocks: +800000 @100, +200000 @150.
		await processBlock(def, def.name, 100, {
			preloaded: makeBlock(100, [
				{ kind: "mint", recipient: A, amount: "800000" },
			]),
		});
		await processBlock(def, def.name, 150, {
			preloaded: makeBlock(150, [
				{ kind: "mint", recipient: A, amount: "200000" },
			]),
		});
		expect(await balanceOf(pgSchema, A)).toBe(1000000n);

		// Reorg at 140: only block 150's delta is orphaned. The journal restores
		// the row to its pre-fork state — 800000 survives, +200000 reverts.
		await handleSubgraphReorg(140, async () => def);

		expect(await balanceOf(pgSchema, A)).toBe(800000n);
	});

	it("reverts increment-based balances the same way (prod seed-def path)", async () => {
		const pgSchema = `sg_acc_b2c_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeIncrementDef(`acc-b2c-${randomUUID().slice(0, 8)}`);
		await registerSubgraph(def, pgSchema);

		const A = "SP1G48FZ4Y9SMP2C5HPRGQ8X9XQ7Y0Y9F9PMKQZ7H";
		const B = "SP2TX6EG1TX6P1YXRRX1CBS7HK9GC9VPABPJ1E665";

		await processBlock(def, def.name, 200, {
			preloaded: makeBlock(200, [
				{ kind: "mint", recipient: A, amount: "500" },
			]),
		});
		// Fork-era block: A pays B 200 (same-block receive semantics included).
		await processBlock(def, def.name, 250, {
			preloaded: makeBlock(250, [
				{ kind: "transfer", sender: A, recipient: B, amount: "200" },
			]),
		});
		expect(await balanceOf(pgSchema, A)).toBe(300n);
		expect(await balanceOf(pgSchema, B)).toBe(200n);

		await handleSubgraphReorg(240, async () => def);

		// A restored to pre-fork 500; B (created in the fork era) is gone.
		expect(await balanceOf(pgSchema, A)).toBe(500n);
		expect(await balanceOf(pgSchema, B)).toBeNull();
	});

	it("end-to-end: reindex + live blocks + replay + reorg conserves supply", async () => {
		const pgSchema = `sg_acc_e2e_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeIncrementDef(`acc-e2e-${randomUUID().slice(0, 8)}`);
		await registerSubgraph(def, pgSchema);

		const A = "SP1G48FZ4Y9SMP2C5HPRGQ8X9XQ7Y0Y9F9PMKQZ7H";
		const B = "SP2TX6EG1TX6P1YXRRX1CBS7HK9GC9VPABPJ1E665";
		const C = "SP3R9DNHRSBPT42JX98J92ZJHASWSBXT5ZW8X4XCK";
		const reindexOpts = {
			skipProgressUpdate: true,
			atomicProgress: { status: "reindexing" },
		};
		const sumBalances = async () => {
			const { rows } = await sql
				.raw(
					`SELECT COALESCE(SUM(balance), 0) AS s FROM "${pgSchema}"."balances"`,
				)
				.execute(db);
			return BigInt(String((rows as { s: string }[])[0]?.s ?? 0));
		};

		// Reindex phase: mint, then a mixed block (transfer + mint, one tx).
		await processBlock(def, def.name, 1000, {
			...reindexOpts,
			preloaded: makeBlock(1000, [
				{ kind: "mint", recipient: A, amount: "1000" },
			]),
		});
		await processBlock(def, def.name, 1001, {
			...reindexOpts,
			preloaded: makeBlock(1001, [
				{ kind: "transfer", sender: A, recipient: B, amount: "400" },
				{ kind: "mint", recipient: B, amount: "50" },
			]),
		});
		// Crash-replay of the mixed block: must be skipped.
		const replay = await processBlock(def, def.name, 1001, {
			...reindexOpts,
			preloaded: makeBlock(1001, [
				{ kind: "transfer", sender: A, recipient: B, amount: "400" },
				{ kind: "mint", recipient: B, amount: "50" },
			]),
		});
		expect(replay.skipped).toBe(true);

		// Lifecycle transition the harness bypasses: in production,
		// reindexSubgraph completion flips reindexing → active before any live
		// processing. The live walk itself only promotes (deploying/error →
		// active) and never unparks an explicit "reindexing" — so model the
		// completion here.
		await getDb()
			.updateTable("subgraphs")
			.set({ status: "active" })
			.where("name", "=", def.name)
			.execute();

		// Live phase (journaled): B pays C, C burns part of it.
		await processBlock(def, def.name, 1002, {
			preloaded: makeBlock(1002, [
				{ kind: "transfer", sender: B, recipient: C, amount: "100" },
				{ kind: "burn", sender: C, amount: "30" },
			]),
		});
		expect(await balanceOf(pgSchema, A)).toBe(600n);
		expect(await balanceOf(pgSchema, B)).toBe(350n);
		expect(await balanceOf(pgSchema, C)).toBe(70n);
		// Supply: 1050 minted − 30 burned.
		expect(await sumBalances()).toBe(1020n);

		// Reorg orphans block 1002: C disappears, B's payment reverts, burn undone.
		await handleSubgraphReorg(1002, async () => def);
		expect(await balanceOf(pgSchema, A)).toBe(600n);
		expect(await balanceOf(pgSchema, B)).toBe(450n);
		expect(await balanceOf(pgSchema, C)).toBeNull();
		// Supply back to pre-fork: 1050 minted, no burns.
		expect(await sumBalances()).toBe(1050n);
	});

	it("a reorg straddling multiple fork-era touches restores the earliest pre-image", async () => {
		const pgSchema = `sg_acc_b2d_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeIncrementDef(`acc-b2d-${randomUUID().slice(0, 8)}`);
		await registerSubgraph(def, pgSchema);

		const A = "SP1G48FZ4Y9SMP2C5HPRGQ8X9XQ7Y0Y9F9PMKQZ7H";
		await processBlock(def, def.name, 300, {
			preloaded: makeBlock(300, [
				{ kind: "mint", recipient: A, amount: "1000" },
			]),
		});
		// Three fork-era touches.
		for (const [h, amt] of [
			[350, "10"],
			[351, "20"],
			[352, "30"],
		] as const) {
			await processBlock(def, def.name, h, {
				preloaded: makeBlock(h, [{ kind: "mint", recipient: A, amount: amt }]),
			});
		}
		expect(await balanceOf(pgSchema, A)).toBe(1060n);

		await handleSubgraphReorg(350, async () => def);
		expect(await balanceOf(pgSchema, A)).toBe(1000n);
	});

	it("deletes nothing it shouldn't: row first created post-fork loses only post-fork deltas", async () => {
		const pgSchema = `sg_acc_b2b_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeDef(`acc-b2b-${randomUUID().slice(0, 8)}`);
		await registerSubgraph(def, pgSchema);

		const A = "SP1G48FZ4Y9SMP2C5HPRGQ8X9XQ7Y0Y9F9PMKQZ7H";

		// Row first created at 150 (post-fork): its only delta is orphaned.
		await processBlock(def, def.name, 150, {
			preloaded: makeBlock(150, [
				{ kind: "mint", recipient: A, amount: "200000" },
			]),
		});
		await handleSubgraphReorg(140, async () => def);

		// All of A's history is orphaned → no row (or zero) is correct.
		const bal = await balanceOf(pgSchema, A);
		expect(bal === null || bal === 0n).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// B4 — uint columns reject negatives at the database (generator CHECK)
// ---------------------------------------------------------------------------

describe("uint columns fail loudly instead of storing negatives", () => {
	/** Create the schema with the REAL generator DDL (includes CHECK + journal). */
	async function createViaGenerator(
		def: SubgraphDefinition,
		pgSchema: string,
	): Promise<void> {
		createdSchemas.push(pgSchema);
		const { statements } = generateSubgraphSQL(def, pgSchema);
		for (const stmt of statements) {
			await sql.raw(stmt).execute(db);
		}
	}

	it("a debit exceeding the balance aborts the block (no silent negative)", async () => {
		const pgSchema = `sg_acc_b4_${randomUUID().slice(0, 8)}`;
		const def = makeIncrementDef(`acc-b4-${randomUUID().slice(0, 8)}`);
		await createViaGenerator(def, pgSchema);
		await registerSubgraph(def, pgSchema);

		const A = "SP1G48FZ4Y9SMP2C5HPRGQ8X9XQ7Y0Y9F9PMKQZ7H";
		const B = "SP2TX6EG1TX6P1YXRRX1CBS7HK9GC9VPABPJ1E665";
		await processBlock(def, def.name, 100, {
			preloaded: makeBlock(100, [
				{ kind: "mint", recipient: A, amount: "100" },
			]),
		});

		// A only has 100 — a 150 debit means the indexer missed a credit.
		// The CHECK aborts the whole block instead of storing -50.
		await expect(
			processBlock(def, def.name, 101, {
				preloaded: makeBlock(101, [
					{ kind: "transfer", sender: A, recipient: B, amount: "150" },
				]),
			}),
		).rejects.toThrow();

		// Block tx rolled back: no partial state.
		expect(await balanceOf(pgSchema, A)).toBe(100n);
		expect(await balanceOf(pgSchema, B)).toBeNull();
	});

	it("legitimate same-block receive-then-forward passes the CHECK (chain order)", async () => {
		const pgSchema = `sg_acc_b4b_${randomUUID().slice(0, 8)}`;
		const def = makeIncrementDef(`acc-b4b-${randomUUID().slice(0, 8)}`);
		await createViaGenerator(def, pgSchema);
		await registerSubgraph(def, pgSchema);

		const A = "SP1G48FZ4Y9SMP2C5HPRGQ8X9XQ7Y0Y9F9PMKQZ7H";
		const B = "SP2TX6EG1TX6P1YXRRX1CBS7HK9GC9VPABPJ1E665";
		// Mint funds A and A forwards them in the SAME block — valid on-chain,
		// must not trip the CHECK (mint event precedes the transfer).
		const result = await processBlock(def, def.name, 200, {
			preloaded: makeBlock(200, [
				{ kind: "mint", recipient: A, amount: "500" },
				{ kind: "transfer", sender: A, recipient: B, amount: "500" },
			]),
		});
		expect(result.errors).toBe(0);
		expect(await balanceOf(pgSchema, A)).toBe(0n);
		expect(await balanceOf(pgSchema, B)).toBe(500n);
	});
});
