import { getDb, getRawClient } from "@secondlayer/shared/db";
import { updateViewStatus } from "@secondlayer/shared/db/queries/views";
import { logger } from "@secondlayer/shared/logger";
import { generateViewSQL } from "../schema/generator.ts";
import { pgSchemaName } from "../schema/utils.ts";
import type { ViewDefinition } from "../types.ts";
import { processBlock } from "./block-processor.ts";

const LOG_INTERVAL = 1000;

export interface ReindexOptions {
  fromBlock?: number;
  toBlock?: number;
  schemaName?: string;
}

/**
 * Reindex a view by dropping its tables, recreating them, and reprocessing
 * all historical blocks through the handler pipeline.
 */
export async function reindexView(
  def: ViewDefinition,
  opts?: ReindexOptions,
): Promise<{ processed: number }> {
  const db = getDb();
  const client = getRawClient();
  const viewName = def.name;
  const schemaName = opts?.schemaName ?? pgSchemaName(viewName);

  // Set status to reindexing
  await updateViewStatus(db, viewName, "reindexing");

  logger.info("Reindex starting", { view: viewName });

  try {
    // Drop and recreate schema + tables
    await client.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);

    const { statements } = generateViewSQL(def, schemaName);
    for (const stmt of statements) {
      await client.unsafe(stmt);
    }

    logger.info("Schema recreated for reindex", { view: viewName });

    // Determine block range
    const fromBlock = opts?.fromBlock ?? 1;
    let toBlock = opts?.toBlock;

    if (!toBlock) {
      const progress = await db
        .selectFrom("index_progress")
        .selectAll()
        .where("network", "=", process.env.NETWORK ?? "mainnet")
        .executeTakeFirst();
      toBlock = progress?.last_indexed_block ?? progress?.last_contiguous_block ?? 0;
    }

    if (fromBlock > toBlock) {
      logger.info("No blocks to reindex", { view: viewName, fromBlock, toBlock });
      await updateViewStatus(db, viewName, "active", 0);
      return { processed: 0 };
    }

    const totalBlocks = toBlock - fromBlock + 1;
    logger.info("Reindexing blocks", { view: viewName, fromBlock, toBlock, totalBlocks });

    let blocksProcessed = 0;
    let totalEventsProcessed = 0;
    let totalErrors = 0;
    const PROGRESS_INTERVAL = 100; // update DB progress every N blocks

    for (let height = fromBlock; height <= toBlock; height++) {
      const result = await processBlock(def, viewName, height, { skipProgressUpdate: true });
      blocksProcessed++;
      totalEventsProcessed += result.processed;
      totalErrors += result.errors;

      // Batch progress updates to avoid NOTIFY storm
      if (blocksProcessed % PROGRESS_INTERVAL === 0) {
        await updateViewStatus(db, viewName, "reindexing", height);
      }

      if (blocksProcessed % LOG_INTERVAL === 0) {
        logger.info("Reindex progress", {
          view: viewName,
          processed: blocksProcessed,
          total: totalBlocks,
          currentBlock: height,
          pct: Math.round((blocksProcessed / totalBlocks) * 100),
        });
      }
    }

    // Write final health metrics in one update
    const { recordViewProcessed } = await import("@secondlayer/shared/db/queries/views");
    if (totalEventsProcessed > 0 || totalErrors > 0) {
      await recordViewProcessed(db, viewName, totalEventsProcessed, totalErrors,
        totalErrors > 0 ? `${totalErrors} error(s) during reindex` : undefined);
    }

    // Done — set back to active
    await updateViewStatus(db, viewName, "active", toBlock);

    logger.info("Reindex complete", { view: viewName, blocks: blocksProcessed, events: totalEventsProcessed, errors: totalErrors });
    return { processed: blocksProcessed };
  } catch (err) {
    logger.error("Reindex failed", {
      view: viewName,
      error: err instanceof Error ? err.message : String(err),
    });
    await updateViewStatus(db, viewName, "error");
    throw err;
  }
}
