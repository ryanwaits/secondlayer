import { getTargetDb } from "@secondlayer/shared/db";
import { getSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
import { logger } from "@secondlayer/shared/logger";
import type { SubgraphDefinition } from "../types.ts";
import { type BlockData, avgEventsPerBlock } from "./batch-loader.ts";
import {
	type ProcessBlockResult,
	processBlockWithRetry,
} from "./block-processor.ts";
import { resolveBlockSource } from "./block-source.ts";
import { StatsAccumulator } from "./stats.ts";

const LOG_INTERVAL = 1000;
const STANDARD_CATCHUP_BATCH_CONFIG = {
	defaultBatchSize: 500,
	minBatchSize: 100,
	maxBatchSize: 1000,
	prefetch: true,
};

const catchingUp = new Set<string>();

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

		// Pipeline: start loading first batch and track the prefetched range.
		// batchEnd must match what was actually loaded — not recalculated from a
		// potentially resized batchSize (adaptive sizing can change it between iterations).
		let prefetchedBatchEnd = Math.min(currentHeight + batchSize - 1, chainTip);
		let nextBatchPromise = batchConfig.prefetch
			? source.loadBlockRange(currentHeight, prefetchedBatchEnd)
			: undefined;

		while (currentHeight <= chainTip) {
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

				let result: ProcessBlockResult;
				try {
					result = await processBlockWithRetry(subgraph, subgraphName, height, {
						preloaded: blockData,
					});
				} catch (err) {
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
