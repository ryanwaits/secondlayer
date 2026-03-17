import { getDb } from "@secondlayer/shared/db";
import { sql } from "@secondlayer/shared";
import { logger } from "@secondlayer/shared/logger";
import type { Transaction } from "kysely";
import type { Database } from "@secondlayer/shared/db";

/**
 * Handles chain reorganizations
 * Marks old blocks as non-canonical and invalidates their jobs
 */
export async function handleReorg(
  blockHeight: number,
  oldHash: string,
  newHash: string,
): Promise<void> {
  const db = getDb();

  logger.warn("Handling chain reorganization", {
    blockHeight,
    oldHash,
    newHash,
  });

  await db.transaction().execute(async (tx: Transaction<Database>) => {
    // Mark old block as non-canonical
    await tx
      .updateTable("blocks")
      .set({ canonical: false })
      .where("height", "=", blockHeight)
      .where("hash", "=", oldHash)
      .execute();

    // Invalidate jobs for this block
    // Set them to failed status so they don't get reprocessed
    await tx
      .updateTable("jobs")
      .set({
        status: "failed",
        error: `Block reorganization detected - block ${blockHeight} is no longer canonical`,
      })
      .where("block_height", "=", blockHeight)
      .where("status", "in", ["pending", "processing"])
      .execute();

    // Notify subgraph processor about the reorg
    await sql`SELECT pg_notify('subgraph_reorg', ${JSON.stringify({ blockHeight, oldHash, newHash })})`.execute(tx);

    logger.info("Reorganization handled", {
      blockHeight,
      invalidatedJobs: "updated",
    });
  });
}

/**
 * Detects if a new block represents a reorganization
 * Returns true if reorg detected
 */
export async function detectReorg(
  blockHeight: number,
  newHash: string,
): Promise<{ isReorg: boolean; oldHash?: string }> {
  const db = getDb();

  const existingBlock = await db
    .selectFrom("blocks")
    .selectAll()
    .where("height", "=", blockHeight)
    .where("canonical", "=", true)
    .limit(1)
    .executeTakeFirst();

  if (!existingBlock) {
    return { isReorg: false };
  }

  if (existingBlock.hash !== newHash) {
    return {
      isReorg: true,
      oldHash: existingBlock.hash,
    };
  }

  return { isReorg: false };
}
