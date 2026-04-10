import { getErrorMessage } from "@secondlayer/shared";
import { getDb, getRawClient } from "@secondlayer/shared/db";
import {
	type GapRange,
	recordGapBatch,
	resolveGaps,
} from "@secondlayer/shared/db/queries/subgraph-gaps";
import {
	recordSubgraphProcessed,
	updateSubgraphStatus,
} from "@secondlayer/shared/db/queries/subgraphs";
import { logger } from "@secondlayer/shared/logger";
import { generateSubgraphSQL } from "../schema/generator.ts";
import { pgSchemaName } from "../schema/utils.ts";
import type { SubgraphDefinition } from "../types.ts";
import { avgEventsPerBlock, loadBlockRange } from "./batch-loader.ts";
import { type ProcessBlockResult, processBlock } from "./block-processor.ts";
import { StatsAccumulator } from "./stats.ts";

const LOG_INTERVAL = 1000;
const DEFAULT_BATCH_SIZE = 500;
const MIN_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 1000;

/**
 * Coalesce individual block heights + reasons into contiguous gap ranges.
 */
function coalesceFailedBlocks(
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

export interface ReindexOptions {
	fromBlock?: number;
	toBlock?: number;
	schemaName?: string;
	signal?: AbortSignal;
}

/**
 * Shared block range processor used by both reindex and backfill.
 * Processes blocks in batches with prefetch pipeline.
 * Supports cancellation via AbortSignal — breaks cleanly at batch boundaries.
 */
async function processBlockRange(
	def: SubgraphDefinition,
	opts: {
		fromBlock: number;
		toBlock: number;
		status: string;
		isCatchup: boolean;
		apiKeyId: string | null;
		subgraphId?: string;
		signal?: AbortSignal;
	},
): Promise<{
	blocksProcessed: number;
	totalEventsProcessed: number;
	totalErrors: number;
	aborted: boolean;
}> {
	const db = getDb();
	const subgraphName = def.name;
	const { fromBlock, toBlock, status } = opts;
	const totalBlocks = toBlock - fromBlock + 1;

	const stats = new StatsAccumulator(
		subgraphName,
		opts.apiKeyId,
		opts.isCatchup,
	);
	let blocksProcessed = 0;
	let totalEventsProcessed = 0;
	let totalErrors = 0;
	let batchSize = DEFAULT_BATCH_SIZE;
	let currentHeight = fromBlock;
	let aborted = false;

	// Pipeline: start loading first batch and track the prefetched range.
	// batchEnd must match what was actually loaded — not recalculated from a
	// potentially resized batchSize (adaptive sizing can change it between iterations).
	let nextBatchEnd = Math.min(currentHeight + batchSize - 1, toBlock);
	let nextBatchPromise = loadBlockRange(db, currentHeight, nextBatchEnd);

	while (currentHeight <= toBlock) {
		// Check for abort at batch boundary
		if (opts.signal?.aborted) {
			aborted = true;
			logger.info("Block processing aborted", {
				subgraph: subgraphName,
				currentBlock: currentHeight,
				reason: String(opts.signal.reason ?? "unknown"),
			});
			break;
		}

		const batch = await nextBatchPromise;
		const batchEnd = nextBatchEnd;

		// Prefetch next batch (uses current batchSize, which may have been adapted)
		const nextStart = batchEnd + 1;
		if (nextStart <= toBlock) {
			nextBatchEnd = Math.min(nextStart + batchSize - 1, toBlock);
			nextBatchPromise = loadBlockRange(db, nextStart, nextBatchEnd);
		}

		const batchFailedBlocks: { height: number; reason: string }[] = [];

		for (let height = currentHeight; height <= batchEnd; height++) {
			const blockData = batch.get(height);
			if (!blockData) {
				batchFailedBlocks.push({ height, reason: "block_missing" });
				blocksProcessed++;
				continue;
			}

			let result: ProcessBlockResult;
			try {
				result = await processBlock(def, subgraphName, height, {
					skipProgressUpdate: true,
					preloaded: blockData,
				});
			} catch (err) {
				const errorMsg = err instanceof Error ? err.message : String(err);
				logger.error("Block processing error", {
					subgraph: subgraphName,
					blockHeight: height,
					error: errorMsg,
				});
				batchFailedBlocks.push({ height, reason: "processing_error" });
				await updateSubgraphStatus(db, subgraphName, status, height).catch(
					() => {},
				);
				await recordSubgraphProcessed(db, subgraphName, 0, 1, errorMsg).catch(
					() => {},
				);
				blocksProcessed++;
				totalErrors++;
				continue;
			}

			blocksProcessed++;
			totalEventsProcessed += result.processed;
			totalErrors += result.errors;

			if (result.timing) {
				stats.record(result.timing, result.processed);
				if (stats.shouldFlush()) {
					await stats.flush(db);
				}
			}

			// Batch progress updates
			if (blocksProcessed % 100 === 0) {
				await updateSubgraphStatus(db, subgraphName, status, height);
			}

			if (blocksProcessed % LOG_INTERVAL === 0) {
				logger.info(
					`${status === "reindexing" ? "Reindex" : "Backfill"} progress`,
					{
						subgraph: subgraphName,
						processed: blocksProcessed,
						total: totalBlocks,
						currentBlock: height,
						pct: Math.round((blocksProcessed / totalBlocks) * 100),
					},
				);
			}
		}

		// Record any gaps from this batch
		if (batchFailedBlocks.length > 0 && opts.subgraphId) {
			const gaps = coalesceFailedBlocks(batchFailedBlocks);
			await recordGapBatch(db, opts.subgraphId, subgraphName, gaps).catch(
				(err: unknown) => {
					logger.warn("Failed to record subgraph gaps", {
						subgraph: subgraphName,
						error: err instanceof Error ? err.message : String(err),
					});
				},
			);
		}

		// Adaptive batch sizing
		const avg = avgEventsPerBlock(batch);
		if (avg > 50)
			batchSize = Math.max(Math.round(batchSize * 0.5), MIN_BATCH_SIZE);
		else if (avg < 10)
			batchSize = Math.min(Math.round(batchSize * 1.5), MAX_BATCH_SIZE);

		currentHeight = batchEnd + 1;
	}

	await stats.flush(db);
	return { blocksProcessed, totalEventsProcessed, totalErrors, aborted };
}

/**
 * Resolve block range from options, defaulting to def.startBlock..chain_tip.
 */
async function resolveBlockRange(
	db: ReturnType<typeof getDb>,
	def: SubgraphDefinition,
	opts?: ReindexOptions,
): Promise<{ fromBlock: number; toBlock: number }> {
	const fromBlock = opts?.fromBlock ?? def.startBlock ?? 1;
	let toBlock: number;

	if (opts?.toBlock != null) {
		toBlock = opts.toBlock;
	} else {
		const progress = await db
			.selectFrom("index_progress")
			.selectAll()
			.where("network", "=", process.env.NETWORK ?? "mainnet")
			.executeTakeFirst();
		toBlock = progress?.highest_seen_block ?? 0;
	}

	return { fromBlock, toBlock };
}

/**
 * Clear reindex metadata columns after completion or cancellation.
 */
async function clearReindexMetadata(
	db: ReturnType<typeof getDb>,
	subgraphName: string,
): Promise<void> {
	await db
		.updateTable("subgraphs")
		.set({ reindex_from_block: null, reindex_to_block: null })
		.where("name", "=", subgraphName)
		.execute();
}

/**
 * Reindex a subgraph by dropping its tables, recreating them, and reprocessing
 * all historical blocks through the handler pipeline.
 * Supports cancellation via AbortSignal — on shutdown abort, status stays
 * "reindexing" for auto-resume; on user cancel, status resets to "active".
 */
export async function reindexSubgraph(
	def: SubgraphDefinition,
	opts?: ReindexOptions,
): Promise<{ processed: number }> {
	const db = getDb();
	const client = getRawClient();
	const subgraphName = def.name;
	const schemaName = opts?.schemaName ?? pgSchemaName(subgraphName);

	await updateSubgraphStatus(db, subgraphName, "reindexing");
	logger.info("Reindex starting", { subgraph: subgraphName });

	try {
		// Resolve block range BEFORE schema drop so we can persist metadata
		const { fromBlock, toBlock } = await resolveBlockRange(db, def, opts);

		if (fromBlock > toBlock) {
			logger.info("No blocks to reindex", {
				subgraph: subgraphName,
				fromBlock,
				toBlock,
			});
			await updateSubgraphStatus(db, subgraphName, "active", 0);
			return { processed: 0 };
		}

		// Store reindex range so we can resume after a crash
		await db
			.updateTable("subgraphs")
			.set({ reindex_from_block: fromBlock, reindex_to_block: toBlock })
			.where("name", "=", subgraphName)
			.execute();

		// Drop and recreate schema + tables
		await client.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
		const { statements } = generateSubgraphSQL(def, schemaName);
		for (const stmt of statements) {
			await client.unsafe(stmt);
		}
		logger.info("Schema recreated for reindex", { subgraph: subgraphName });

		logger.info("Reindexing blocks", {
			subgraph: subgraphName,
			fromBlock,
			toBlock,
			totalBlocks: toBlock - fromBlock + 1,
		});

		const subgraphRow = await db
			.selectFrom("subgraphs")
			.select(["id", "api_key_id"])
			.where("name", "=", subgraphName)
			.executeTakeFirst();

		const result = await processBlockRange(def, {
			fromBlock,
			toBlock,
			status: "reindexing",
			isCatchup: false,
			apiKeyId: subgraphRow?.api_key_id ?? null,
			subgraphId: subgraphRow?.id,
			signal: opts?.signal,
		});

		// Handle abort
		if (result.aborted) {
			const reason = String(opts?.signal?.reason ?? "unknown");
			if (reason === "user-cancelled") {
				await updateSubgraphStatus(db, subgraphName, "active");
				await clearReindexMetadata(db, subgraphName);
				logger.info("Reindex cancelled by user", { subgraph: subgraphName });
			} else {
				// shutdown — leave status as "reindexing" for auto-resume
				logger.info("Reindex interrupted by shutdown, will resume", {
					subgraph: subgraphName,
				});
			}
			return { processed: result.blocksProcessed };
		}

		// Write final health metrics
		const { recordSubgraphProcessed } = await import(
			"@secondlayer/shared/db/queries/subgraphs"
		);
		if (result.totalEventsProcessed > 0 || result.totalErrors > 0) {
			await recordSubgraphProcessed(
				db,
				subgraphName,
				result.totalEventsProcessed,
				result.totalErrors,
				result.totalErrors > 0
					? `${result.totalErrors} error(s) during reindex`
					: undefined,
			);
		}

		await updateSubgraphStatus(db, subgraphName, "active", toBlock);
		await clearReindexMetadata(db, subgraphName);
		logger.info("Reindex complete", {
			subgraph: subgraphName,
			blocks: result.blocksProcessed,
			events: result.totalEventsProcessed,
			errors: result.totalErrors,
		});
		return { processed: result.blocksProcessed };
	} catch (err) {
		logger.error("Reindex failed", {
			subgraph: subgraphName,
			error: getErrorMessage(err),
		});
		await updateSubgraphStatus(db, subgraphName, "error");
		throw err;
	}
}

/**
 * Resume a previously interrupted reindex. Skips schema drop (already done)
 * and continues from last_processed_block + 1.
 */
export async function resumeReindex(
	def: SubgraphDefinition,
	opts: {
		schemaName: string;
		signal?: AbortSignal;
	},
): Promise<{ processed: number }> {
	const db = getDb();
	const subgraphName = def.name;

	const row = await db
		.selectFrom("subgraphs")
		.select([
			"id",
			"api_key_id",
			"last_processed_block",
			"reindex_from_block",
			"reindex_to_block",
		])
		.where("name", "=", subgraphName)
		.executeTakeFirst();

	if (!row) throw new Error(`Subgraph "${subgraphName}" not found`);

	// Legacy: no reindex metadata — fall back to full reindex
	if (row.reindex_from_block == null || row.reindex_to_block == null) {
		logger.info("No reindex metadata, starting fresh reindex", {
			subgraph: subgraphName,
		});
		return reindexSubgraph(def, {
			schemaName: opts.schemaName,
			signal: opts.signal,
		});
	}

	const fromBlock = Math.max(
		row.last_processed_block + 1,
		row.reindex_from_block,
	);
	const toBlock = row.reindex_to_block;

	if (fromBlock > toBlock) {
		logger.info("Resume: no remaining blocks", { subgraph: subgraphName });
		await updateSubgraphStatus(db, subgraphName, "active", toBlock);
		await clearReindexMetadata(db, subgraphName);
		return { processed: 0 };
	}

	logger.info("Resuming reindex", {
		subgraph: subgraphName,
		fromBlock,
		toBlock,
		remaining: toBlock - fromBlock + 1,
	});

	try {
		const result = await processBlockRange(def, {
			fromBlock,
			toBlock,
			status: "reindexing",
			isCatchup: false,
			apiKeyId: row.api_key_id ?? null,
			subgraphId: row.id,
			signal: opts.signal,
		});

		if (result.aborted) {
			const reason = String(opts.signal?.reason ?? "unknown");
			if (reason === "user-cancelled") {
				await updateSubgraphStatus(db, subgraphName, "active");
				await clearReindexMetadata(db, subgraphName);
				logger.info("Resume cancelled by user", { subgraph: subgraphName });
			} else {
				logger.info("Resume interrupted by shutdown, will resume again", {
					subgraph: subgraphName,
				});
			}
			return { processed: result.blocksProcessed };
		}

		const { recordSubgraphProcessed } = await import(
			"@secondlayer/shared/db/queries/subgraphs"
		);
		if (result.totalEventsProcessed > 0 || result.totalErrors > 0) {
			await recordSubgraphProcessed(
				db,
				subgraphName,
				result.totalEventsProcessed,
				result.totalErrors,
				result.totalErrors > 0
					? `${result.totalErrors} error(s) during resumed reindex`
					: undefined,
			);
		}

		await updateSubgraphStatus(db, subgraphName, "active", toBlock);
		await clearReindexMetadata(db, subgraphName);
		logger.info("Resumed reindex complete", {
			subgraph: subgraphName,
			blocks: result.blocksProcessed,
		});
		return { processed: result.blocksProcessed };
	} catch (err) {
		logger.error("Resumed reindex failed", {
			subgraph: subgraphName,
			error: getErrorMessage(err),
		});
		await updateSubgraphStatus(db, subgraphName, "error");
		throw err;
	}
}

/**
 * Backfill a subgraph by re-processing a block range WITHOUT dropping the schema.
 * Uses upserts so existing data is updated, not duplicated. Safe to run while
 * the subgraph is actively syncing.
 */
export async function backfillSubgraph(
	def: SubgraphDefinition,
	opts: {
		fromBlock: number;
		toBlock: number;
		schemaName?: string;
		signal?: AbortSignal;
	},
): Promise<{ processed: number }> {
	const db = getDb();
	const subgraphName = def.name;

	logger.info("Backfill starting", {
		subgraph: subgraphName,
		from: opts.fromBlock,
		to: opts.toBlock,
	});

	try {
		const subgraphRow = await db
			.selectFrom("subgraphs")
			.select(["id", "api_key_id"])
			.where("name", "=", subgraphName)
			.executeTakeFirst();

		const result = await processBlockRange(def, {
			fromBlock: opts.fromBlock,
			toBlock: opts.toBlock,
			status: "active",
			isCatchup: false,
			apiKeyId: subgraphRow?.api_key_id ?? null,
			subgraphId: subgraphRow?.id,
			signal: opts.signal,
		});

		if (result.aborted) {
			logger.info("Backfill aborted", { subgraph: subgraphName });
			return { processed: result.blocksProcessed };
		}

		// Resolve any gaps within the backfilled range
		const resolved = await resolveGaps(
			db,
			subgraphName,
			opts.fromBlock,
			opts.toBlock,
		).catch(() => 0);
		if (resolved > 0) {
			logger.info("Resolved subgraph gaps via backfill", {
				subgraph: subgraphName,
				resolved,
			});
		}

		// Write final health metrics
		const { recordSubgraphProcessed } = await import(
			"@secondlayer/shared/db/queries/subgraphs"
		);
		if (result.totalEventsProcessed > 0 || result.totalErrors > 0) {
			await recordSubgraphProcessed(
				db,
				subgraphName,
				result.totalEventsProcessed,
				result.totalErrors,
				result.totalErrors > 0
					? `${result.totalErrors} error(s) during backfill`
					: undefined,
			);
		}

		logger.info("Backfill complete", {
			subgraph: subgraphName,
			blocks: result.blocksProcessed,
			events: result.totalEventsProcessed,
			errors: result.totalErrors,
		});
		return { processed: result.blocksProcessed };
	} catch (err) {
		logger.error("Backfill failed", {
			subgraph: subgraphName,
			error: getErrorMessage(err),
		});
		throw err;
	}
}
