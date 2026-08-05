import { getTargetDb, sql } from "@secondlayer/shared/db";
import { getSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
import { logger } from "@secondlayer/shared/logger";
import type { SubgraphDefinition } from "../types.ts";
import { type BlockData, avgEventsPerBlock } from "./batch-loader.ts";
import {
	type ProcessBlockResult,
	processBlockWithRetry,
} from "./block-processor.ts";
import { resolveBlockSource } from "./block-source.ts";
import { isCatchUpLeader } from "./catchup-leader.ts";
import { StatsAccumulator } from "./stats.ts";

const LOG_INTERVAL = 1000;
const STANDARD_CATCHUP_BATCH_CONFIG = {
	defaultBatchSize: 500,
	minBatchSize: 100,
	maxBatchSize: 1000,
	prefetch: true,
};

const catchingUp = new Set<string>();

/**
 * f057 guard: `recordLiveProgress` (subgraphs.ts) writes `last_processed_block`
 * unconditionally — no monotonic guard — because the reorg rewind MUST be able
 * to move the cursor backward. That means a catch-up walk's forward writes and
 * a reorg's backward rewind must never interleave for the same subgraph, or
 * whichever commits last wins regardless of correctness. `catchingUp` (above)
 * only excludes concurrent catch-ups; it does nothing against a reorg.
 *
 * Catch-up and the reorg handler can only ever race within the SAME process:
 * catch-up only ever runs on the catch-up leader (processor.ts `runCatchUp`),
 * and the reorg NOTIFY listener runs on every process including that leader —
 * so for THAT pair an in-process guard is sufficient.
 *
 * The reindex/backfill walk is the exception, and it is why the advisory lock
 * below exists. `startSubgraphOperationRunner` (processor.ts) is NOT
 * leader-gated — it runs on every processor instance — so a reindex or
 * backfill for subgraph S can be walking on instance B while the catch-up
 * leader walks the same S on instance A. They share no JS state, so the
 * in-process mutex serializes nothing between them. Backfill makes this
 * routine rather than exotic: it runs at status 'active', the exact status
 * `runCatchUp` selects on, and it never changes that status, so catch-up has
 * no reason to stand down.
 *
 * Acquisition order — every lock around a subgraph write, outermost first.
 * A fourth lock MUST slot into this order or it can deadlock:
 *
 *   1. `withSubgraphBlockLock`  — in-process mutex, per subgraph name
 *   2. `subgraph-reorg:<name>`  — advisory xact lock (reorg.ts, reorg only)
 *   3. `subgraph-block:<name>`  — advisory xact lock (below, walks only)
 *
 * No path holds (2) and (3) at once: the reorg handler reprocesses the fork
 * block through `processBlock` directly, never through a walk, so it never
 * reaches (3); and neither walk ever takes (2). The order is therefore only
 * ever exercised as 1→2 (reorg) or 1→3 (walks), and no cycle exists.
 *
 * Two pieces, used together by catchUpSubgraph (below) and handleSubgraphReorg
 * (reorg.ts):
 *
 * - `withSubgraphBlockLock` is a per-subgraph mutex held for the duration of
 *   ONE block's write — catch-up acquires it around each individual block it
 *   commits (not around the whole walk), and the reorg handler acquires it
 *   around its entire delete+reprocess+rewind sequence for a subgraph. So a
 *   reorg only ever waits out a single in-flight block commit, never an
 *   entire remaining catch-up walk — and since the lock is per-subgraph name,
 *   a slow catch-up on one subgraph never stalls reorg handling for another
 *   (handleSubgraphReorg processes subgraphs sequentially).
 * - `reorgEpoch` is a monotonic per-subgraph counter, bumped by
 *   handleSubgraphReorg BEFORE it acquires the lock (so the bump is visible
 *   immediately, independent of how long the lock wait takes, and is never
 *   "cleared" — there's no race in un-setting a flag too early). catchUpSubgraph
 *   snapshots the epoch once at the start of its walk and, after acquiring the
 *   lock for each block, checks it again: a changed epoch means a reorg
 *   touched this subgraph's cursor at some point during the walk, so the
 *   walk's local progress state can no longer be trusted — it aborts the
 *   whole tick without writing anything further. The next catch-up tick
 *   re-reads `last_processed_block` fresh from the DB (line ~108) and resumes
 *   correctly from the post-reorg cursor.
 */
const subgraphBlockLockHeld = new Set<string>();
const subgraphBlockLockWaiters = new Map<string, Array<() => void>>();
const reorgEpoch = new Map<string, number>();

async function acquireSubgraphBlockLock(name: string): Promise<() => void> {
	if (!subgraphBlockLockHeld.has(name)) {
		subgraphBlockLockHeld.add(name);
		return () => releaseSubgraphBlockLock(name);
	}
	return new Promise<() => void>((resolve) => {
		const waiters = subgraphBlockLockWaiters.get(name) ?? [];
		waiters.push(() => resolve(() => releaseSubgraphBlockLock(name)));
		subgraphBlockLockWaiters.set(name, waiters);
	});
}

function releaseSubgraphBlockLock(name: string): void {
	const waiters = subgraphBlockLockWaiters.get(name);
	if (waiters && waiters.length > 0) {
		const next = waiters.shift() as () => void;
		if (waiters.length === 0) subgraphBlockLockWaiters.delete(name);
		next(); // hand the lock straight to the next waiter (FIFO), stays held
		return;
	}
	subgraphBlockLockHeld.delete(name);
}

/** Run `fn` (a single block's write, or a reorg's whole rewind) holding the
 *  per-subgraph block lock. Exported for reorg.ts. */
export async function withSubgraphBlockLock<T>(
	name: string,
	fn: () => Promise<T>,
): Promise<T> {
	const release = await acquireSubgraphBlockLock(name);
	try {
		return await fn();
	} finally {
		release();
	}
}

/**
 * Cross-process half of the block lock: a transaction-scoped Postgres advisory
 * lock keyed `subgraph-block:<name>`, held for the duration of `fn`.
 *
 * Held, not merely acquired: each block's own write transaction is opened
 * INSIDE `processBlock` (block-processor.ts — `targetDb.transaction()` for
 * managed subgraphs, `route.dataDb.transaction()` for BYO), and that boundary
 * is load-bearing for the f069 replay guard, so the lock cannot be taken on
 * the writing connection. Instead this wraps the write in a separate
 * lock-holding transaction on the target DB, exactly as the reorg lock does
 * (reorg.ts): `pg_advisory_xact_lock` releases only when THIS transaction
 * commits, regardless of which other connections `fn` awaits meanwhile.
 * Transaction-scoped rather than session-scoped so a crashed walk can never
 * strand the lock.
 *
 * The lock lives on the target DB even for BYO subgraphs — same as the reorg
 * lock — because it coordinates control-plane walkers, not data-plane rows.
 *
 * Connection budget: this holds one pooled target-DB connection while `fn`
 * takes another for the write, so an in-flight block costs 2 of
 * `DATABASE_POOL_MAX` (default 20). Concurrent block writes are bounded by
 * catch-up fan-out (5 subgraphs) plus operation concurrency (1) = 6 blocks =
 * 12 connections. Raising either concurrency knob must be checked against the
 * pool, or the wrapping transactions can starve the writes they wrap.
 */
export async function withSubgraphBlockAdvisoryLock<T>(
	name: string,
	fn: () => Promise<T>,
): Promise<T> {
	return getTargetDb()
		.transaction()
		.execute(async (lockTx) => {
			await sql`SELECT pg_advisory_xact_lock(hashtext(${`subgraph-block:${name}`}))`.execute(
				lockTx,
			);
			return fn();
		});
}

/**
 * One block's write, holding BOTH halves of the block lock in the documented
 * order: the in-process mutex, then the cross-process advisory lock. Every
 * walk that writes a subgraph's schema — live catch-up, reindex, backfill —
 * must go through this, or it serializes against nothing.
 */
export async function withSubgraphBlockWriteLock<T>(
	name: string,
	fn: () => Promise<T>,
): Promise<T> {
	return withSubgraphBlockLock(name, () =>
		withSubgraphBlockAdvisoryLock(name, fn),
	);
}

/** Bump a subgraph's reorg epoch. Call BEFORE acquiring the block lock so the
 *  bump is visible to any concurrent catch-up immediately. Exported for
 *  reorg.ts. */
export function bumpReorgEpoch(name: string): void {
	reorgEpoch.set(name, (reorgEpoch.get(name) ?? 0) + 1);
}

function getReorgEpoch(name: string): number {
	return reorgEpoch.get(name) ?? 0;
}

/** Thrown inside the lock to unwind a catch-up walk when a reorg's epoch bump
 *  is observed mid-walk — distinct from a real processing failure so the
 *  caller aborts silently instead of marking the subgraph "error". */
class ReorgEpochChangedError extends Error {
	constructor(name: string) {
		super(`reorg epoch changed for ${name} mid catch-up`);
		this.name = "ReorgEpochChangedError";
	}
}

type CatchupBatchConfig = {
	defaultBatchSize: number;
	minBatchSize: number;
	maxBatchSize: number;
	prefetch: boolean;
};

type CatchupBatchEnv = {
	SUBGRAPH_CATCHUP_BATCH_SIZE?: string;
	SUBGRAPH_CATCHUP_MIN_BATCH_SIZE?: string;
	SUBGRAPH_CATCHUP_MAX_BATCH_SIZE?: string;
	SUBGRAPH_CATCHUP_PREFETCH?: string;
};

function parsePositiveInt(value: string | undefined): number | undefined {
	if (value == null || value.trim() === "") return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
	if (value == null || value.trim() === "") return undefined;
	const normalized = value.trim().toLowerCase();
	if (normalized === "true") return true;
	if (normalized === "false") return false;
	return undefined;
}

export function resolveCatchupBatchConfig(
	env: CatchupBatchEnv = process.env as CatchupBatchEnv,
): CatchupBatchConfig {
	const base = STANDARD_CATCHUP_BATCH_CONFIG;
	const minBatchSize =
		parsePositiveInt(env.SUBGRAPH_CATCHUP_MIN_BATCH_SIZE) ?? base.minBatchSize;
	const maxBatchSize =
		parsePositiveInt(env.SUBGRAPH_CATCHUP_MAX_BATCH_SIZE) ?? base.maxBatchSize;
	const defaultBatchSize =
		parsePositiveInt(env.SUBGRAPH_CATCHUP_BATCH_SIZE) ?? base.defaultBatchSize;

	return {
		minBatchSize,
		maxBatchSize,
		defaultBatchSize: Math.min(
			Math.max(defaultBatchSize, minBatchSize),
			maxBatchSize,
		),
		prefetch: parseBoolean(env.SUBGRAPH_CATCHUP_PREFETCH) ?? base.prefetch,
	};
}

/**
 * Adjust batch size based on event density.
 * Sparse blocks (early chain) → larger batches. Dense blocks → smaller batches.
 */
function adjustBatchSize(
	current: number,
	avgEvents: number,
	config: CatchupBatchConfig,
): number {
	if (avgEvents > 50)
		return Math.max(Math.round(current * 0.5), config.minBatchSize);
	if (avgEvents < 10)
		return Math.min(Math.round(current * 1.5), config.maxBatchSize);
	return current;
}

/**
 * Catch a subgraph up from its last_processed_block to the chain tip.
 * Uses batch loading (3 queries per batch instead of 3 per block) and
 * plan-aware pipeline prefetching.
 */
export async function catchUpSubgraph(
	subgraph: SubgraphDefinition,
	subgraphName: string,
): Promise<number> {
	if (catchingUp.has(subgraphName)) return 0;
	catchingUp.add(subgraphName);

	try {
		const source = resolveBlockSource(subgraph);
		const targetDb = getTargetDb();

		// Re-read from DB to avoid stale lastProcessedBlock
		const subgraphRow = await getSubgraph(targetDb, subgraphName);
		if (!subgraphRow) return 0;
		const lastProcessedBlock = Number(subgraphRow.last_processed_block);

		// Chain tip comes from the block source (indexer DB today; Streams clock
		// once re-pointed).
		const chainTip = await source.getTip();
		if (chainTip <= 0 || lastProcessedBlock >= chainTip) return 0;

		const subgraphStart = Number(subgraphRow.start_block) || 1;
		const startBlock = Math.max(lastProcessedBlock + 1, subgraphStart);
		const totalBlocks = chainTip - lastProcessedBlock;

		logger.info("Subgraph catch-up starting", {
			subgraph: subgraphName,
			from: startBlock,
			to: chainTip,
			blocks: totalBlocks,
		});

		const stats = new StatsAccumulator(subgraphName, true);
		let processed = 0;
		const batchConfig = resolveCatchupBatchConfig();
		let batchSize = batchConfig.defaultBatchSize;
		let currentHeight = startBlock;
		// f057: snapshot the epoch once — see the guard comment above
		// `subgraphBlockLockHeld` for the invariant this protects.
		const walkEpoch = getReorgEpoch(subgraphName);

		// Pipeline: start loading first batch and track the prefetched range.
		// batchEnd must match what was actually loaded — not recalculated from a
		// potentially resized batchSize (adaptive sizing can change it between iterations).
		let prefetchedBatchEnd = Math.min(currentHeight + batchSize - 1, chainTip);
		let nextBatchPromise = batchConfig.prefetch
			? source.loadBlockRange(currentHeight, prefetchedBatchEnd)
			: undefined;

		while (currentHeight <= chainTip) {
			// f069: per-iteration leadership check. `isCatchUpLeader()` reads this
			// process's own in-memory lease state (catchup-leader.ts) — no DB
			// query, so it's cheap enough to check every batch. Pre-f069, only
			// `runCatchUp`'s entry gate (processor.ts) checked leadership, so a
			// process that lost its advisory-lock connection mid-walk (driver
			// auto-reconnect silently drops the session lock — leader.ts:84-99)
			// kept committing blocks indefinitely while a new leader walked the
			// same range: the two writers' overlapping commits, combined with
			// `recordLiveProgress` regressing the cursor on every laggard write,
			// is the mechanism the f068 investigation traced to the July burst.
			// The conditional cursor advance (block-processor.ts) now makes an
			// overlap safe even if this check somehow missed a beat, but ending
			// the laggard's walk promptly is still the right behavior — it stops
			// wasted work and the log noise of every write losing its race.
			if (!isCatchUpLeader()) {
				logger.info("Lost catch-up leadership, stopping catch-up", {
					subgraph: subgraphName,
					processed,
				});
				break;
			}

			// Check if subgraph status changed (e.g. reindex started) — bail if so
			const currentRow = await getSubgraph(targetDb, subgraphName);
			if (!currentRow || currentRow.status !== "active") {
				logger.info("Subgraph status changed, stopping catch-up", {
					subgraph: subgraphName,
					status: currentRow?.status ?? "deleted",
				});
				break;
			}

			let batchEnd: number;
			let batch: Map<number, BlockData>;
			if (nextBatchPromise) {
				batch = await nextBatchPromise;
				batchEnd = prefetchedBatchEnd;

				// Start prefetching next batch while we process this one.
				const nextStart = batchEnd + 1;
				if (nextStart <= chainTip) {
					prefetchedBatchEnd = Math.min(nextStart + batchSize - 1, chainTip);
					nextBatchPromise = source.loadBlockRange(
						nextStart,
						prefetchedBatchEnd,
					);
				} else {
					nextBatchPromise = undefined;
				}
			} else {
				// Low-memory mode: load only the current batch, process it, then size
				// and load the next batch after this iteration completes.
				batchEnd = Math.min(currentHeight + batchSize - 1, chainTip);
				batch = await source.loadBlockRange(currentHeight, batchEnd);
			}

			// Process each block from pre-loaded data
			let stopCatchup = false;

			for (let height = currentHeight; height <= batchEnd; height++) {
				let blockData = batch.get(height);
				if (!blockData) {
					// Refetch once — distinguishes a transient source hiccup from a
					// genuinely absent block.
					blockData = (await source.loadBlockRange(height, height)).get(height);
				}
				if (!blockData) {
					// Near the tip this is usually a reorg race (the height briefly
					// has no canonical block). Stop the tick with the cursor BEFORE
					// this height — the next catch-up re-attempts it. Skipping it
					// instead would silently drop its events (fix-f040 B5).
					logger.warn("Block missing during catch-up, deferring to next tick", {
						subgraph: subgraphName,
						blockHeight: height,
					});
					stopCatchup = true;
					break;
				}
				const preloaded = blockData;

				let result: ProcessBlockResult;
				try {
					// Hold both halves of the per-subgraph block lock for this one
					// block's write — the in-process mutex (excludes a same-process
					// reorg) and the advisory lock (excludes a reindex/backfill walk
					// on another instance) — and bail without writing if a reorg's
					// epoch bump landed mid-walk. See the guard comment near
					// subgraphBlockLockHeld.
					result = await withSubgraphBlockWriteLock(subgraphName, async () => {
						if (getReorgEpoch(subgraphName) !== walkEpoch) {
							throw new ReorgEpochChangedError(subgraphName);
						}
						return processBlockWithRetry(subgraph, subgraphName, height, {
							preloaded,
						});
					});
				} catch (err) {
					if (err instanceof ReorgEpochChangedError) {
						logger.info(
							"Reorg detected mid catch-up, aborting walk without writing further progress",
							{ subgraph: subgraphName, blockHeight: height },
						);
						stopCatchup = true;
						break;
					}
					// Persistent failure: halt with the cursor before this block.
					// Advancing past it would bake the missing events into every
					// downstream row (fix-f040 B5).
					const errorMsg = err instanceof Error ? err.message : String(err);
					logger.error("Block processing failed persistently during catch-up", {
						subgraph: subgraphName,
						blockHeight: height,
						error: errorMsg,
					});
					const { updateSubgraphStatus, recordSubgraphProcessed } =
						await import("@secondlayer/shared/db/queries/subgraphs");
					await recordSubgraphProcessed(
						targetDb,
						subgraphName,
						0,
						1,
						`catch-up halted at block ${height}: ${errorMsg}`,
					).catch(() => {});
					await updateSubgraphStatus(targetDb, subgraphName, "error").catch(
						() => {},
					);
					stopCatchup = true;
					break;
				}
				processed++;

				if (result.timing) {
					stats.record(result.timing, result.processed);
					if (stats.shouldFlush()) {
						await stats.flush(targetDb);
					}
				}

				if (processed % LOG_INTERVAL === 0) {
					logger.info("Subgraph catch-up progress", {
						subgraph: subgraphName,
						processed,
						total: totalBlocks,
						currentBlock: height,
						pct: Math.round((processed / totalBlocks) * 100),
					});
				}
			}

			// A missing block or persistent failure stops the walk with the
			// cursor before the problem height — never record-and-skip.
			if (stopCatchup) break;

			// Adaptive batch sizing based on event density
			const avg = avgEventsPerBlock(batch);
			batchSize = adjustBatchSize(batchSize, avg, batchConfig);

			currentHeight = batchEnd + 1;
		}

		// Flush remaining stats
		await stats.flush(targetDb);

		logger.info("Subgraph catch-up complete", {
			subgraph: subgraphName,
			processed,
		});

		return processed;
	} finally {
		catchingUp.delete(subgraphName);
	}
}
