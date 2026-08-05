import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, getTargetDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import type { LeaderBackend } from "@secondlayer/shared/leader";
import type { Kysely } from "kysely";
import { generateSubgraphSQL } from "../schema/generator.ts";
import type {
	SubgraphContext,
	SubgraphDefinition,
	SubgraphHandler,
	SubgraphSchema,
} from "../types.ts";
import { startCatchUpLeader } from "./catchup-leader.ts";
import {
	catchUpSubgraph,
	withSubgraphBlockAdvisoryLock,
	withSubgraphBlockLock,
} from "./catchup.ts";
import { backfillSubgraph } from "./reindex.ts";

/**
 * Two walks can write one subgraph's schema at the same time.
 *
 * `catchUpSubgraph` holds a per-subgraph block lock for each block it commits;
 * `processBlockRange` (reindex/backfill) held nothing at all. Backfill runs at
 * status 'active' — the exact status `runCatchUp` selects on — and never
 * changes it, so catch-up has no reason to stand down. The operation runner is
 * also not leader-gated, so the two walks are routinely in different
 * processes, which is why the in-process mutex alone could not have closed
 * this: the serializing lock has to be the Postgres advisory lock.
 *
 * The corruption is a lost update, not a lost delta: `ctx.patchOrInsert` reads
 * the row, computes from what it read, and writes back at flush. Two
 * interleaved block transactions both read the pre-state and the second
 * overwrites the first. The increment flush retry does not help here — that
 * guards `ctx.increment`'s additive path only.
 *
 * The handlers below make the interleave deterministic instead of timing-
 * dependent: each one announces itself and then waits for the other walk to
 * announce, with a grace timeout. When the lock works, the second walk cannot
 * reach its handler until the first walk's transaction commits, so the first
 * waits out the full grace and the two reads are ordered — final total 2. With
 * no lock both handlers meet at the barrier, both read the pre-state, and one
 * update is lost — final total 1.
 */

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const FIRST = 7_000;
const LAST = 7_010;
/** Walked by the backfill/reindex side, and by every single-block walk here. */
const BACKFILL_HEIGHT = 7_002;
/** Walked by the live catch-up side. */
const CATCHUP_HEIGHT = 7_008;
const ASSET = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.lockt::lockt";
const BLOCK_HASH_PREFIX = "0xlockwalk";
const TX_ID_PREFIX = "0xlockwalktx";
const KEY = "SP_SHARED_ROW";
/** Long enough that an unserialized walk always reaches the barrier first. */
const GRACE_MS = 1_500;

let db: Kysely<Database>;
let priorTip: number | null = null;
let stopLeader: () => Promise<void>;
const createdSchemas: string[] = [];
const createdSubgraphNames: string[] = [];
const createdOperationIds: string[] = [];
const childMarkers: string[] = [];
let childExit: Promise<number> | null = null;

const schema = {
	counters: {
		columns: {
			id: { type: "principal", indexed: true },
			total: { type: "uint" },
		},
		uniqueKeys: [["id"]],
	},
} as unknown as SubgraphSchema;

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Handler hooks, set per test. `enter` runs before the read-modify-write. */
let enter: ((tag: string) => Promise<void>) | null = null;
let exit: ((tag: string) => void) | null = null;

/**
 * One read-modify-write of a row shared by every walk in this file. The read
 * is `patchOrInsert`'s `findOne`; the write lands at flush, inside the block's
 * transaction. Ordering-sensitive by construction.
 */
function makeDef(name: string, tag: string): SubgraphDefinition {
	return {
		name,
		startBlock: FIRST,
		sources: { mint: { type: "ft_mint", assetIdentifier: ASSET } },
		schema,
		handlers: {
			mint: (async (_e: unknown, ctx: SubgraphContext) => {
				await enter?.(tag);
				await ctx.patchOrInsert(
					"counters",
					{ id: KEY },
					{
						total: (existing: Record<string, unknown> | null) =>
							existing ? BigInt(String(existing.total)) + 1n : 1n,
					},
				);
				exit?.(tag);
			}) as unknown as SubgraphHandler,
		},
	} as unknown as SubgraphDefinition;
}

async function seedChain(): Promise<void> {
	const blocks = [];
	for (let h = FIRST; h <= LAST; h++) {
		blocks.push({
			height: h,
			hash: `${BLOCK_HASH_PREFIX}${h}`,
			parent_hash: `${BLOCK_HASH_PREFIX}${h - 1}`,
			burn_block_height: h + 900_000,
			burn_block_hash: null,
			timestamp: 1_700_000_000 + h,
			canonical: true,
		});
	}
	await db
		.insertInto("blocks")
		.values(blocks)
		.onConflict((oc) => oc.column("height").doNothing())
		.execute();

	for (const h of [BACKFILL_HEIGHT, CATCHUP_HEIGHT]) {
		const txId = `${TX_ID_PREFIX}${h}`;
		await db
			.insertInto("transactions")
			.values({
				tx_id: txId,
				block_height: h,
				tx_index: 0,
				type: "contract_call",
				sender: `SPLOCKSENDER${h}`,
				status: "success",
				contract_id: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.lockt",
				function_name: "mint",
				raw_tx: "0x00",
			} as never)
			.onConflict((oc) => oc.doNothing())
			.execute();
		await db
			.insertInto("events")
			.values({
				id: randomUUID(),
				tx_id: txId,
				block_height: h,
				event_index: 0,
				type: "ft_mint_event",
				data: {
					asset_identifier: ASSET,
					amount: "1",
					recipient: KEY,
				},
			} as never)
			.onConflict((oc) => oc.doNothing())
			.execute();
	}
}

async function setTip(value: number): Promise<void> {
	const network = process.env.NETWORK ?? "mainnet";
	await db
		.insertInto("index_progress")
		.values({ network, highest_seen_block: value } as never)
		.onConflict((oc) =>
			oc.column("network").doUpdateSet({ highest_seen_block: value }),
		)
		.execute();
}

async function readTip(): Promise<number | null> {
	const row = await db
		.selectFrom("index_progress")
		.select("highest_seen_block")
		.where("network", "=", process.env.NETWORK ?? "mainnet")
		.executeTakeFirst();
	return row ? Number(row.highest_seen_block) : null;
}

async function register(
	def: SubgraphDefinition,
	pgSchema: string,
	overrides: Record<string, unknown> = {},
): Promise<string> {
	createdSubgraphNames.push(def.name);
	createdSchemas.push(pgSchema);
	const row = await db
		.insertInto("subgraphs")
		.values({
			name: def.name,
			status: "active",
			definition: def as unknown as Record<string, unknown>,
			schema_hash: "test",
			handler_path: "test",
			schema_name: pgSchema,
			account_id: randomUUID(),
			start_block: FIRST,
			last_processed_block: 0,
			...overrides,
		} as never)
		.returning("id")
		.executeTakeFirstOrThrow();
	for (const stmt of generateSubgraphSQL(def, pgSchema).statements) {
		await sql.raw(stmt).execute(db);
	}
	return String(row.id);
}

/**
 * A backfill always runs under an operation row in production, and that is
 * load-bearing for this harness: without one, `processBlockRange` leaves
 * `atomicProgress` unset and every block at or below the live cursor is
 * dropped by the f069 live-path replay guard before a handler ever runs.
 */
async function backfillOp(
	subgraphId: string,
	subgraphName: string,
): Promise<string> {
	const row = await db
		.insertInto("subgraph_operations")
		.values({
			subgraph_id: subgraphId,
			subgraph_name: subgraphName,
			kind: "backfill",
			status: "running",
			from_block: BACKFILL_HEIGHT,
			to_block: BACKFILL_HEIGHT,
		} as never)
		.returning("id")
		.executeTakeFirstOrThrow();
	const id = String(row.id);
	createdOperationIds.push(id);
	return id;
}

async function totalIn(pgSchema: string): Promise<string | undefined> {
	const { rows } = await sql
		.raw(`SELECT total::text AS t FROM "${pgSchema}"."counters"`)
		.execute(db);
	return (rows as { t: string }[])[0]?.t;
}

function unique(prefix: string): { name: string; pgSchema: string } {
	const id = randomUUID().slice(0, 8).replace(/-/g, "");
	return {
		name: `walklock-${prefix}-${id}`,
		pgSchema: `sg_walklock_${prefix}_${id}`,
	};
}

beforeAll(async () => {
	db = getDb();
	priorTip = await readTip();
	await seedChain();
	await setTip(CATCHUP_HEIGHT);
	// catchUpSubgraph bails unless this process holds the catch-up lease; these
	// tests drive it directly rather than through the leader-gated entry point.
	stopLeader = startCatchUpLeader({
		createBackend: (): LeaderBackend => ({
			tryAcquire: async () => true,
			ping: async () => {},
			close: async () => {},
		}),
		pollMs: 10_000,
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
});

afterAll(async () => {
	await stopLeader();
	enter = null;
	exit = null;
	for (const m of childMarkers) rmSync(m, { force: true });
	for (const s of createdSchemas) {
		await sql.raw(`DROP SCHEMA IF EXISTS "${s}" CASCADE`).execute(db);
	}
	for (const id of createdOperationIds) {
		await db.deleteFrom("subgraph_operations").where("id", "=", id).execute();
	}
	for (const n of createdSubgraphNames) {
		await db.deleteFrom("subgraphs").where("name", "=", n).execute();
	}
	await db
		.deleteFrom("events")
		.where("tx_id", "like", `${TX_ID_PREFIX}%`)
		.execute();
	await db
		.deleteFrom("transactions")
		.where("tx_id", "like", `${TX_ID_PREFIX}%`)
		.execute();
	await db
		.deleteFrom("blocks")
		.where("hash", "like", `${BLOCK_HASH_PREFIX}%`)
		.execute();
	if (priorTip !== null) await setTip(priorTip);
});

describe("per-subgraph block lock across walks", () => {
	test("a backfill walk and the live catch-up walk serialize on the same subgraph", async () => {
		const { name, pgSchema } = unique("same");
		const backfillDef = makeDef(name, "backfill");
		const catchupDef = makeDef(name, "catchup");
		// Cursor just below the catch-up height so catch-up walks exactly one
		// block, and the backfill walks exactly one other block. Distinct heights:
		// the point is interleaved writes to a shared row, not double-processing.
		const subgraphId = await register(backfillDef, pgSchema, {
			last_processed_block: CATCHUP_HEIGHT - 1,
		});
		const operationId = await backfillOp(subgraphId, name);

		const arrived: Record<string, ReturnType<typeof deferred>> = {
			backfill: deferred(),
			catchup: deferred(),
		};
		let inHandler = 0;
		let maxInHandler = 0;
		enter = async (tag) => {
			inHandler++;
			maxInHandler = Math.max(maxInHandler, inHandler);
			arrived[tag]?.resolve();
			const other = tag === "backfill" ? arrived.catchup : arrived.backfill;
			await Promise.race([other?.promise, sleep(GRACE_MS)]);
		};
		exit = () => {
			inHandler--;
		};

		await Promise.all([
			backfillSubgraph(backfillDef, {
				fromBlock: BACKFILL_HEIGHT,
				toBlock: BACKFILL_HEIGHT,
				operationId,
			}),
			catchUpSubgraph(catchupDef, name),
		]);

		// Serialized: each walk's read saw the other's committed write, so both
		// updates survive. Unserialized, both read the empty pre-state and the
		// second write overwrites the first, leaving "1".
		expect(await totalIn(pgSchema)).toBe("2");
		// Direct evidence of exclusion, not just a happy-ending row value: the
		// two walks were never inside a block write at the same time.
		expect(maxInHandler).toBe(1);
	}, 30_000);

	test("walks on different subgraphs still run concurrently", async () => {
		const a = unique("othera");
		const b = unique("otherb");
		const defA = makeDef(a.name, "A");
		const defB = makeDef(b.name, "B");
		const opA = await backfillOp(await register(defA, a.pgSchema), a.name);
		const opB = await backfillOp(await register(defB, b.pgSchema), b.name);

		const arrived: Record<string, ReturnType<typeof deferred>> = {
			A: deferred(),
			B: deferred(),
		};
		const outcomes: string[] = [];
		let inHandler = 0;
		let maxInHandler = 0;
		enter = async (tag) => {
			inHandler++;
			maxInHandler = Math.max(maxInHandler, inHandler);
			arrived[tag]?.resolve();
			const other = tag === "A" ? arrived.B : arrived.A;
			outcomes.push(
				await Promise.race([
					(other?.promise as Promise<void>).then(() => "met"),
					sleep(GRACE_MS).then(() => "timeout"),
				]),
			);
		};
		exit = () => {
			inHandler--;
		};

		await Promise.all([
			backfillSubgraph(defA, {
				fromBlock: BACKFILL_HEIGHT,
				toBlock: BACKFILL_HEIGHT,
				operationId: opA,
			}),
			backfillSubgraph(defB, {
				fromBlock: BACKFILL_HEIGHT,
				toBlock: BACKFILL_HEIGHT,
				operationId: opB,
			}),
		]);

		// A global (rather than per-subgraph) lock would show up here as a
		// "timeout" — the second walk never reaching its handler in time.
		expect(outcomes).toEqual(["met", "met"]);
		expect(maxInHandler).toBe(2);
		expect(await totalIn(a.pgSchema)).toBe("1");
		expect(await totalIn(b.pgSchema)).toBe("1");
	}, 30_000);

	test("a walk waits out the reorg locks instead of deadlocking against them", async () => {
		const { name, pgSchema } = unique("reorg");
		const def = makeDef(name, "reorg-contender");
		const operationId = await backfillOp(await register(def, pgSchema), name);
		enter = null;
		exit = null;

		// Exactly the lock pair `handleSubgraphReorg` holds around its
		// delete+reprocess+rewind (reorg.ts): the in-process block mutex, then the
		// transaction-scoped `subgraph-reorg:<name>` advisory lock. Held directly
		// rather than by calling handleSubgraphReorg, which rewinds EVERY active
		// subgraph in the database — including ones other test files own.
		const held = deferred();
		const release = deferred();
		let walkDone = false;
		let walkDoneBeforeRelease = false;

		const reorgSide = withSubgraphBlockLock(name, () =>
			getTargetDb()
				.transaction()
				.execute(async (lockTx) => {
					await sql`SELECT pg_advisory_xact_lock(hashtext(${`subgraph-reorg:${name}`}))`.execute(
						lockTx,
					);
					held.resolve();
					await release.promise;
				}),
		);

		await held.promise;
		const walk = backfillSubgraph(def, {
			fromBlock: BACKFILL_HEIGHT,
			toBlock: BACKFILL_HEIGHT,
			operationId,
		}).then(() => {
			walkDone = true;
		});

		// The walk must be parked on the in-process mutex, not through it.
		await sleep(500);
		walkDoneBeforeRelease = walkDone;
		release.resolve();

		await Promise.race([
			Promise.all([reorgSide, walk]),
			sleep(15_000).then(() => {
				throw new Error("deadlock: reorg locks and walk never both settled");
			}),
		]);

		expect(walkDoneBeforeRelease).toBe(false);
		expect(walkDone).toBe(true);
		expect(await totalIn(pgSchema)).toBe("1");
	}, 30_000);

	/**
	 * The one test the other three cannot be: they run both walks in a single
	 * process, where the in-process mutex alone would serialize them. The
	 * operation runner is not leader-gated, so the real deployment has the
	 * reindex/backfill walk in a DIFFERENT process from the catch-up leader —
	 * no shared JS state, so only the Postgres advisory lock can serialize
	 * them. This runs the walk in a genuine second Bun process while this one
	 * holds `subgraph-block:<name>`, which is exactly the contention an
	 * in-process mutex is blind to.
	 */
	test("a walk in another process blocks on the advisory lock", async () => {
		const { name, pgSchema } = unique("xproc");
		const def = makeDef(name, "xproc");
		const operationId = await backfillOp(await register(def, pgSchema), name);

		const ready = join(tmpdir(), `walklock-ready-${randomUUID()}`);
		const done = join(tmpdir(), `walklock-done-${randomUUID()}`);
		childMarkers.push(ready, done);

		const child = `
			const { backfillSubgraph } = await import(${JSON.stringify(join(import.meta.dir, "reindex.ts"))});
			const def = {
				name: process.env.WALK_NAME,
				startBlock: ${FIRST},
				sources: { mint: { type: "ft_mint", assetIdentifier: ${JSON.stringify(ASSET)} } },
				schema: ${JSON.stringify(schema)},
				handlers: {
					mint: async (_e, ctx) => {
						await ctx.patchOrInsert("counters", { id: ${JSON.stringify(KEY)} }, {
							total: (existing) => existing ? BigInt(String(existing.total)) + 1n : 1n,
						});
					},
				},
			};
			await Bun.write(process.env.WALK_READY, "ready");
			await backfillSubgraph(def, {
				fromBlock: ${BACKFILL_HEIGHT},
				toBlock: ${BACKFILL_HEIGHT},
				operationId: process.env.WALK_OP,
			});
			await Bun.write(process.env.WALK_DONE, "done");
			process.exit(0);
		`;

		let doneWhileLocked = false;
		let exitCode: number | null = null;

		await withSubgraphBlockAdvisoryLock(name, async () => {
			const proc = Bun.spawn(["bun", "-e", child], {
				cwd: join(import.meta.dir, "..", ".."),
				env: {
					...process.env,
					WALK_NAME: name,
					WALK_OP: operationId,
					WALK_READY: ready,
					WALK_DONE: done,
				},
				stdout: "inherit",
				stderr: "inherit",
			});
			childExit = proc.exited;

			const readyBy = Date.now() + 30_000;
			while (!existsSync(ready) && Date.now() < readyBy) await sleep(100);
			expect(existsSync(ready)).toBe(true);

			// Ample time for an unserialized walk: the same one-block backfill
			// finishes in a few hundred ms in the tests above.
			await sleep(3_000);
			doneWhileLocked = existsSync(done);
		});

		exitCode = await childExit;

		// Unserialized, the child's walk commits its block while this process
		// holds the lock — the in-process mutex it also takes means nothing to a
		// separate process.
		expect(doneWhileLocked).toBe(false);
		expect(exitCode).toBe(0);
		expect(existsSync(done)).toBe(true);
		expect(await totalIn(pgSchema)).toBe("1");
	}, 90_000);
});
