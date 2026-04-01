import { getErrorMessage } from "@secondlayer/shared";
import { getDb, getRawClient } from "@secondlayer/shared/db";
import {
	type GapRange,
	recordGapBatch,
	resolveGaps,
} from "@secondlayer/shared/db/queries/subgraph-gaps";
import { updateSubgraphStatus } from "@secondlayer/shared/db/queries/subgraphs";
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
}

/**
 * Shared block range processor used by both reindex and backfill.
 * Processes blocks in batches with prefetch pipeline.
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
	},
): Promise<{
	blocksProcessed: number;
	totalEventsProcessed: number;
	totalErrors: number;
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

	// Pipeline: start loading first batch
	let nextBatchPromise = loadBlockRange(
		db,
		currentHeight,
		Math.min(currentHeight + batchSize - 1, toBlock),
	);

	while (currentHeight <= toBlock) {
		const batch = await nextBatchPromise;
		const batchEnd = Math.min(currentHeight + batchSize - 1, toBlock);

		// Prefetch next batch
		const nextStart = batchEnd + 1;
		if (nextStart <= toBlock) {
			const nextEnd = Math.min(nextStart + batchSize - 1, toBlock);
			nextBatchPromise = loadBlockRange(db, nextStart, nextEnd);
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
				logger.error("Block processing error", {
					subgraph: subgraphName,
					blockHeight: height,
					error: err instanceof Error ? err.message : String(err),
				});
				batchFailedBlocks.push({ height, reason: "processing_error" });
				await updateSubgraphStatus(db, subgraphName, status, height).catch(
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
	return { blocksProcessed, totalEventsProcessed, totalErrors };
}

/**
 * Resolve block range from options, defaulting to 1..chain_tip.
 */
async function resolveBlockRange(
	db: ReturnType<typeof getDb>,
	opts?: ReindexOptions,
): Promise<{ fromBlock: number; toBlock: number }> {
	const fromBlock = opts?.fromBlock ?? 1;
	let toBlock: number;

	if (opts?.toBlock != null) {
		toBlock = opts.toBlock;
	} else {
		const progress = await db
			.selectFrom("index_progress")
			.selectAll()
			.where("network", "=", process.env.NETWORK ?? "mainnet")
			.executeTakeFirst();
		toBlock =
			progress?.last_indexed_block ?? progress?.last_contiguous_block ?? 0;
	}

	return { fromBlock, toBlock };
}

/**
 * Reindex a subgraph by dropping its tables, recreating them, and reprocessing
 * all historical blocks through the handler pipeline.
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
		// Drop and recreate schema + tables
		await client.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
		const { statements } = generateSubgraphSQL(def, schemaName);
		for (const stmt of statements) {
			await client.unsafe(stmt);
		}
		logger.info("Schema recreated for reindex", { subgraph: subgraphName });

		const { fromBlock, toBlock } = await resolveBlockRange(db, opts);

		if (fromBlock > toBlock) {
			logger.info("No blocks to reindex", {
				subgraph: subgraphName,
				fromBlock,
				toBlock,
			});
			await updateSubgraphStatus(db, subgraphName, "active", 0);
			return { processed: 0 };
		}

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
		});

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
 * Backfill a subgraph by re-processing a block range WITHOUT dropping the schema.
 * Uses upserts so existing data is updated, not duplicated. Safe to run while
 * the subgraph is actively syncing.
 */
export async function backfillSubgraph(
	def: SubgraphDefinition,
	opts: { fromBlock: number; toBlock: number; schemaName?: string },
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
		});

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
