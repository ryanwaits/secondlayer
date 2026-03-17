import { getDb, getRawClient } from "@secondlayer/shared/db";
import { updateSubgraphStatus } from "@secondlayer/shared/db/queries/subgraphs";
import { logger } from "@secondlayer/shared/logger";
import { getErrorMessage } from "@secondlayer/shared";
import { generateSubgraphSQL } from "../schema/generator.ts";
import { pgSchemaName } from "../schema/utils.ts";
import type { SubgraphDefinition } from "../types.ts";
import { processBlock } from "./block-processor.ts";
import { StatsAccumulator } from "./stats.ts";

const LOG_INTERVAL = 1000;

export interface ReindexOptions {
  fromBlock?: number;
  toBlock?: number;
  schemaName?: string;
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

  // Set status to reindexing
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

    // Determine block range
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
      toBlock = progress?.last_indexed_block ?? progress?.last_contiguous_block ?? 0;
    }

    if (fromBlock > toBlock) {
      logger.info("No blocks to reindex", { subgraph: subgraphName, fromBlock, toBlock });
      await updateSubgraphStatus(db, subgraphName, "active", 0);
      return { processed: 0 };
    }

    const totalBlocks = toBlock - fromBlock + 1;
    logger.info("Reindexing blocks", { subgraph: subgraphName, fromBlock, toBlock, totalBlocks });

    // Look up api_key_id for stats
    const subgraphRow = await db
      .selectFrom("subgraphs")
      .select("api_key_id")
      .where("name", "=", subgraphName)
      .executeTakeFirst();

    const stats = new StatsAccumulator(subgraphName, subgraphRow?.api_key_id ?? null, false);
    let blocksProcessed = 0;
    let totalEventsProcessed = 0;
    let totalErrors = 0;
    const PROGRESS_INTERVAL = 100; // update DB progress every N blocks

    for (let height = fromBlock; height <= toBlock; height++) {
      const result = await processBlock(def, subgraphName, height, { skipProgressUpdate: true });
      blocksProcessed++;
      totalEventsProcessed += result.processed;
      totalErrors += result.errors;

      if (result.timing) {
        stats.record(result.timing, result.processed);
        if (stats.shouldFlush()) {
          await stats.flush(db);
        }
      }

      // Batch progress updates to avoid NOTIFY storm
      if (blocksProcessed % PROGRESS_INTERVAL === 0) {
        await updateSubgraphStatus(db, subgraphName, "reindexing", height);
      }

      if (blocksProcessed % LOG_INTERVAL === 0) {
        logger.info("Reindex progress", {
          subgraph: subgraphName,
          processed: blocksProcessed,
          total: totalBlocks,
          currentBlock: height,
          pct: Math.round((blocksProcessed / totalBlocks) * 100),
        });
      }
    }

    // Flush remaining stats
    await stats.flush(db);

    // Write final health metrics in one update
    const { recordSubgraphProcessed } = await import("@secondlayer/shared/db/queries/subgraphs");
    if (totalEventsProcessed > 0 || totalErrors > 0) {
      await recordSubgraphProcessed(db, subgraphName, totalEventsProcessed, totalErrors,
        totalErrors > 0 ? `${totalErrors} error(s) during reindex` : undefined);
    }

    // Done — set back to active
    await updateSubgraphStatus(db, subgraphName, "active", toBlock);

    logger.info("Reindex complete", { subgraph: subgraphName, blocks: blocksProcessed, events: totalEventsProcessed, errors: totalErrors });
    return { processed: blocksProcessed };
  } catch (err) {
    logger.error("Reindex failed", {
      subgraph: subgraphName,
      error: getErrorMessage(err),
    });
    await updateSubgraphStatus(db, subgraphName, "error");
    throw err;
  }
}
