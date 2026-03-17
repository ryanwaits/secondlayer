import { getDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { getSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
import type { SubgraphDefinition } from "../types.ts";
import { processBlock } from "./block-processor.ts";
import { StatsAccumulator } from "./stats.ts";

const LOG_INTERVAL = 1000;

const catchingUp = new Set<string>();

/**
 * Catch a subgraph up from its last_processed_block to the chain tip.
 * Re-reads lastProcessedBlock from DB to avoid stale values.
 * Skips if a catch-up is already in progress for this subgraph.
 */
export async function catchUpSubgraph(
  subgraph: SubgraphDefinition,
  subgraphName: string,
): Promise<number> {
  if (catchingUp.has(subgraphName)) return 0;
  catchingUp.add(subgraphName);

  try {
    const db = getDb();

    // Re-read from DB to avoid stale lastProcessedBlock
    const subgraphRow = await getSubgraph(db, subgraphName);
    if (!subgraphRow) return 0;
    const lastProcessedBlock = Number(subgraphRow.last_processed_block);

    // Get chain tip from indexProgress
    const progress = await db
      .selectFrom("index_progress")
      .selectAll()
      .where("network", "=", process.env.NETWORK ?? "mainnet")
      .executeTakeFirst();

    if (!progress) return 0;

    const chainTip = Number(progress.last_contiguous_block);
    if (lastProcessedBlock >= chainTip) return 0;

    const startBlock = lastProcessedBlock + 1;
    const totalBlocks = chainTip - lastProcessedBlock;

    logger.info("Subgraph catch-up starting", {
      subgraph: subgraphName,
      from: startBlock,
      to: chainTip,
      blocks: totalBlocks,
    });

    const stats = new StatsAccumulator(subgraphName, subgraphRow.api_key_id, true);
    let processed = 0;

    for (let height = startBlock; height <= chainTip; height++) {
      const result = await processBlock(subgraph, subgraphName, height);
      processed++;

      if (result.timing) {
        stats.record(result.timing, result.processed);
        if (stats.shouldFlush()) {
          await stats.flush(db);
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

    // Flush remaining stats
    await stats.flush(db);

    logger.info("Subgraph catch-up complete", {
      subgraph: subgraphName,
      processed,
    });

    return processed;
  } finally {
    catchingUp.delete(subgraphName);
  }
}
