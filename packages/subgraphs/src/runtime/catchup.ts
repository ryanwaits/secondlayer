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
const DEFAULT_BATCH_SIZE = 500;
const MIN_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 1000;

const catchingUp = new Set<string>();

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
function adjustBatchSize(current: number, avgEvents: number): number {
	if (avgEvents > 50)
		return Math.max(Math.round(current * 0.5), MIN_BATCH_SIZE);
	if (avgEvents < 10)
		return Math.min(Math.round(current * 1.5), MAX_BATCH_SIZE);
	return current;
}

/**
 * Catch a subgraph up from its last_processed_block to the chain tip.
 * Uses batch loading (3 queries per batch instead of 3 per block) and
 * pipeline prefetching (loads next batch while processing current).
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
		let batchSize = DEFAULT_BATCH_SIZE;
		let currentHeight = startBlock;

		// Pipeline: start loading first batch and track the prefetched range.
		// batchEnd must match what was actually loaded — not recalculated from a
		// potentially resized batchSize (adaptive sizing can change it between iterations).
		let nextBatchEnd = Math.min(currentHeight + batchSize - 1, chainTip);
		let nextBatchPromise = loadBlockRange(
			sourceDb,
			currentHeight,
			nextBatchEnd,
		);

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

			// Await current batch
			const batch = await nextBatchPromise;
			const batchEnd = nextBatchEnd;

			// Start prefetching next batch while we process this one
			const nextStart = batchEnd + 1;
			if (nextStart <= chainTip) {
				nextBatchEnd = Math.min(nextStart + batchSize - 1, chainTip);
				nextBatchPromise = loadBlockRange(sourceDb, nextStart, nextBatchEnd);
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
			batchSize = adjustBatchSize(batchSize, avg);

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
