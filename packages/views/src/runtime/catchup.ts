import { getDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { getView } from "@secondlayer/shared/db/queries/views";
import type { ViewDefinition } from "../types.ts";
import { processBlock } from "./block-processor.ts";

const LOG_INTERVAL = 1000;

const catchingUp = new Set<string>();

/**
 * Catch a view up from its last_processed_block to the chain tip.
 * Re-reads lastProcessedBlock from DB to avoid stale values.
 * Skips if a catch-up is already in progress for this view.
 */
export async function catchUpView(
  view: ViewDefinition,
  viewName: string,
): Promise<number> {
  if (catchingUp.has(viewName)) return 0;
  catchingUp.add(viewName);

  try {
    const db = getDb();

    // Re-read from DB to avoid stale lastProcessedBlock
    const viewRow = await getView(db, viewName);
    if (!viewRow) return 0;
    const lastProcessedBlock = Number(viewRow.last_processed_block);

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

    logger.info("View catch-up starting", {
      view: viewName,
      from: startBlock,
      to: chainTip,
      blocks: totalBlocks,
    });

    let processed = 0;

    for (let height = startBlock; height <= chainTip; height++) {
      await processBlock(view, viewName, height);
      processed++;

      if (processed % LOG_INTERVAL === 0) {
        logger.info("View catch-up progress", {
          view: viewName,
          processed,
          total: totalBlocks,
          currentBlock: height,
          pct: Math.round((processed / totalBlocks) * 100),
        });
      }
    }

    logger.info("View catch-up complete", {
      view: viewName,
      processed,
    });

    return processed;
  } finally {
    catchingUp.delete(viewName);
  }
}
