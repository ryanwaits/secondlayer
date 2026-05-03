import { getSourceDb, getTargetDb } from "@secondlayer/shared/db";
import {
	type GapRange,
	recordGapBatch,
} from "@secondlayer/shared/db/queries/subgraph-gaps";
import { getSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
import { logger } from "@secondlayer/shared/logger";
import type { SubgraphDefinition } from "../types.ts";
import { avgEventsPerBlock, loadBlockRange } from "./batch-loader.ts";
import { type ProcessBlockResult, processBlock } from "./block-processor.ts";
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
 * Coalesce individual block heights + reasons into contiguous gap ranges.
 */
function coalesceGaps(
	blocks: { height: number; reason: string }[],
): GapRange[] {
	if (blocks.length === 0) return [];
	blocks.sort((a, b) => a.height - b.height);

	const ranges: GapRange[] = [];
	let start = blocks[0].height;
	let end = blocks[0].height;
	let reason = blocks[0].reason;

	for (let i = 1; i < blocks.length; i++) {
		const b = blocks[i];
		if (b.height === end + 1 && b.reason === reason) {
			end = b.height;
		} else {
			ranges.push({ start, end, reason });
			start = b.height;
			end = b.height;
			reason = b.reason;
		}
	}
	ranges.push({ start, end, reason });
	return ranges;
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
		const sourceDb = getSourceDb();
		const targetDb = getTargetDb();

		// Re-read from DB to avoid stale lastProcessedBlock
		const subgraphRow = await getSubgraph(targetDb, subgraphName);
		if (!subgraphRow) return 0;
		const lastProcessedBlock = Number(subgraphRow.last_processed_block);

		// Chain tip lives in the shared indexer DB (source)
		const progress = await sourceDb
			.selectFrom("index_progress")
			.selectAll()
			.where("network", "=", process.env.NETWORK ?? "mainnet")
			.executeTakeFirst();

		if (!progress) return 0;

		const chainTip = Number(progress.highest_seen_block);
		if (lastProcessedBlock >= chainTip) return 0;

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
			? loadBlockRange(sourceDb, currentHeight, prefetchedBatchEnd)
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
			let batch: Awaited<ReturnType<typeof loadBlockRange>>;
			if (nextBatchPromise) {
				batch = await nextBatchPromise;
				batchEnd = prefetchedBatchEnd;

				// Start prefetching next batch while we process this one.
				const nextStart = batchEnd + 1;
				if (nextStart <= chainTip) {
					prefetchedBatchEnd = Math.min(nextStart + batchSize - 1, chainTip);
					nextBatchPromise = loadBlockRange(
						sourceDb,
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
				batch = await loadBlockRange(sourceDb, currentHeight, batchEnd);
			}

			// Process each block from pre-loaded data
			const batchFailedBlocks: { height: number; reason: string }[] = [];

			for (let height = currentHeight; height <= batchEnd; height++) {
				const blockData = batch.get(height);
				if (!blockData) {
					// Block missing (gap) — skip
					batchFailedBlocks.push({ height, reason: "block_missing" });
					processed++;
					continue;
				}

				let result: ProcessBlockResult;
				try {
					result = await processBlock(subgraph, subgraphName, height, {
						preloaded: blockData,
					});
				} catch (err) {
					logger.error("Block processing error during catch-up", {
						subgraph: subgraphName,
						blockHeight: height,
						error: err instanceof Error ? err.message : String(err),
					});
					batchFailedBlocks.push({ height, reason: "processing_error" });
					// Update progress past this block so we don't retry it forever
					const { updateSubgraphStatus } = await import(
						"@secondlayer/shared/db/queries/subgraphs"
					);
					await updateSubgraphStatus(
						targetDb,
						subgraphName,
						"active",
						height,
					).catch(() => {});
					processed++;
					continue;
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

			// Record any gaps from this batch
			if (batchFailedBlocks.length > 0) {
				const gaps = coalesceGaps(batchFailedBlocks);
				await recordGapBatch(
					targetDb,
					subgraphRow.id,
					subgraphName,
					gaps,
				).catch((err: unknown) => {
					logger.warn("Failed to record subgraph gaps", {
						subgraph: subgraphName,
						error: err instanceof Error ? err.message : String(err),
					});
				});
			}

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
