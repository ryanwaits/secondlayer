/**
 * Bulk backfill script — standalone Bun script for high-speed historical block ingestion.
 *
 * Designed for use with a self-hosted Hiro API (no rate limits).
 * Writes directly to DB (bypasses /new_block HTTP endpoint).
 * Does NOT enqueue stream jobs — bulk historical data skips webhooks.
 *
 * Usage:
 *   HIRO_API_URL=http://localhost:3999 DATABASE_URL=postgres://... \
 *     bun run packages/indexer/src/bulk-backfill.ts
 *
 * Env vars:
 *   HIRO_API_URL             - Hiro API base URL (default: https://api.mainnet.hiro.so)
 *   DATABASE_URL             - Postgres connection string
 *   BACKFILL_FROM            - Start height (default: 1)
 *   BACKFILL_TO              - End height (default: 0 = auto-detect from Hiro /status)
 *   BACKFILL_CONCURRENCY     - Parallel block fetches (default: 20)
 *   BACKFILL_BATCH_SIZE      - Blocks per DB transaction (default: 100)
 *   BACKFILL_INCLUDE_RAW_TX  - Fetch actual raw_tx hex (default: true)
 *   BACKFILL_RAW_TX_CONCURRENCY - Parallel raw_tx fetches per block (default: 10)
 */

import { getDb, closeDb, sql } from "@secondlayer/shared/db";
import { computeContiguousTip } from "@secondlayer/shared/db/queries/integrity";
import { HiroClient } from "@secondlayer/shared/node/hiro-client";
import type { GetBlockOptions } from "@secondlayer/shared/node/hiro-client";
import type { NewBlockPayload } from "./types/node-events.ts";
import { parseBlock, parseTransaction, parseEvent } from "./parser.ts";
import { logger } from "@secondlayer/shared/logger";
import { existsSync, readFileSync, writeFileSync } from "fs";

// --- Config ---
const BACKFILL_FROM = parseInt(process.env.BACKFILL_FROM || "1");
const BACKFILL_TO = parseInt(process.env.BACKFILL_TO || "0");
const CONCURRENCY = parseInt(process.env.BACKFILL_CONCURRENCY || "20");
const BATCH_SIZE = parseInt(process.env.BACKFILL_BATCH_SIZE || "100");
const INCLUDE_RAW_TX = process.env.BACKFILL_INCLUDE_RAW_TX !== "false";
const RAW_TX_CONCURRENCY = parseInt(process.env.BACKFILL_RAW_TX_CONCURRENCY || "10");
const NETWORK = process.env.STACKS_NETWORK || "mainnet";
const PROGRESS_FILE = "backfill-progress.json";

const TX_CHUNK_SIZE = 500;
const EVT_CHUNK_SIZE = 1000;

/** Strip null bytes from all string values in an object (Postgres text columns reject \0) */
function stripNullBytes(obj: unknown): unknown {
  if (typeof obj === "string") return obj.replaceAll("\0", "");
  if (Array.isArray(obj)) return obj.map(stripNullBytes);
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = stripNullBytes(v);
    }
    return result;
  }
  return obj;
}

interface Progress {
  lastCompletedHeight: number;
  startedAt: string;
  updatedAt: string;
  blocksInserted: number;
}

function loadProgress(): Progress | null {
  if (!existsSync(PROGRESS_FILE)) return null;
  try {
    return JSON.parse(readFileSync(PROGRESS_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function saveProgress(progress: Progress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

/** Query existing block heights in chunks to build a skip-set */
async function loadExistingHeights(db: ReturnType<typeof getDb>, from: number, to: number): Promise<Set<number>> {
  const existing = new Set<number>();
  const chunkSize = 100_000;

  for (let start = from; start <= to; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, to);
    const rows = await db
      .selectFrom("blocks")
      .select("height")
      .where("height", ">=", start)
      .where("height", "<=", end)
      .where("canonical", "=", true)
      .execute();
    for (const row of rows) {
      existing.add(row.height);
    }
  }

  return existing;
}

/** Insert a batch of fetched blocks into DB in a single transaction */
async function insertBatch(
  db: ReturnType<typeof getDb>,
  blocks: NewBlockPayload[],
) {
  // Parse all blocks
  const allBlocks = blocks.map(parseBlock);
  const allTxPromises = blocks.flatMap((b) =>
    b.transactions.map((tx) => parseTransaction(tx, b.block_height))
  );
  const allTxResults = await Promise.all(allTxPromises);
  const allTxs = allTxResults
    .filter((tx): tx is NonNullable<typeof tx> => tx !== null)
    .map((tx) => stripNullBytes(tx) as typeof tx);

  const allEvts = blocks
    .flatMap((b) => b.events.map((evt) => parseEvent(evt, b.block_height)))
    .filter((evt): evt is NonNullable<typeof evt> => evt !== null)
    .map((evt) => stripNullBytes(evt) as typeof evt);

  await db.transaction().execute(async (tx) => {
    // Insert blocks
    for (const block of allBlocks) {
      await tx
        .insertInto("blocks")
        .values(block)
        .onConflict((oc) =>
          oc.column("height").doUpdateSet({
            hash: block.hash,
            parent_hash: block.parent_hash,
            burn_block_height: block.burn_block_height,
            timestamp: block.timestamp,
            canonical: true,
          })
        )
        .execute();
    }

    // Insert transactions in chunks
    for (let i = 0; i < allTxs.length; i += TX_CHUNK_SIZE) {
      await tx
        .insertInto("transactions")
        .values(allTxs.slice(i, i + TX_CHUNK_SIZE))
        .onConflict((oc) => oc.doNothing())
        .execute();
    }

    // Insert events in chunks
    for (let i = 0; i < allEvts.length; i += EVT_CHUNK_SIZE) {
      await tx
        .insertInto("events")
        .values(allEvts.slice(i, i + EVT_CHUNK_SIZE))
        .onConflict((oc) => oc.doNothing())
        .execute();
    }

    // Update index_progress with highest block in batch
    const maxHeight = Math.max(...blocks.map((b) => b.block_height));
    await tx
      .insertInto("index_progress")
      .values({
        network: NETWORK,
        last_indexed_block: maxHeight,
        last_contiguous_block: 0,
        highest_seen_block: maxHeight,
      })
      .onConflict((oc) =>
        oc.column("network").doUpdateSet({
          last_indexed_block: sql`GREATEST(index_progress.last_indexed_block, ${maxHeight})`,
          highest_seen_block: sql`GREATEST(index_progress.highest_seen_block, ${maxHeight})`,
          updated_at: new Date(),
        })
      )
      .execute();
  });
}

async function main() {
  const hiro = new HiroClient();
  const db = getDb();

  // Determine target height
  let targetHeight = BACKFILL_TO;
  if (targetHeight === 0) {
    logger.info("Auto-detecting chain tip from Hiro API...");
    targetHeight = await hiro.fetchChainTip();
    logger.info("Chain tip detected", { height: targetHeight });
  }

  const fromHeight = BACKFILL_FROM;

  // Load resume progress
  const existingProgress = loadProgress();
  let resumeFrom = fromHeight;
  if (existingProgress && existingProgress.lastCompletedHeight >= fromHeight) {
    resumeFrom = existingProgress.lastCompletedHeight + 1;
    logger.info("Resuming from progress file", { resumeFrom, previous: existingProgress });
  }

  logger.info("Bulk backfill starting", {
    from: resumeFrom,
    to: targetHeight,
    concurrency: CONCURRENCY,
    batchSize: BATCH_SIZE,
    includeRawTx: INCLUDE_RAW_TX,
    rawTxConcurrency: RAW_TX_CONCURRENCY,
  });

  // Load existing heights to skip
  logger.info("Loading existing block heights...");
  const existingHeights = await loadExistingHeights(db, resumeFrom, targetHeight);
  logger.info("Existing heights loaded", { count: existingHeights.size });

  // Build list of heights to backfill
  const heights: number[] = [];
  for (let h = resumeFrom; h <= targetHeight; h++) {
    if (!existingHeights.has(h)) heights.push(h);
  }

  logger.info("Heights to backfill", {
    total: heights.length,
    skipped: targetHeight - resumeFrom + 1 - heights.length,
  });

  if (heights.length === 0) {
    logger.info("Nothing to backfill");
    await recomputeContiguousAndClose(db);
    return;
  }

  const blockOptions: GetBlockOptions = {
    includeRawTx: INCLUDE_RAW_TX,
    rawTxConcurrency: RAW_TX_CONCURRENCY,
  };

  const progress: Progress = existingProgress || {
    lastCompletedHeight: resumeFrom - 1,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    blocksInserted: 0,
  };

  const startTime = Date.now();
  let totalInserted = progress.blocksInserted;
  let batchStart = Date.now();

  // Process in batches
  for (let batchIdx = 0; batchIdx < heights.length; batchIdx += BATCH_SIZE) {
    const batchHeights = heights.slice(batchIdx, batchIdx + BATCH_SIZE);

    // Fetch blocks with bounded concurrency
    const fetchedBlocks: NewBlockPayload[] = [];
    for (let i = 0; i < batchHeights.length; i += CONCURRENCY) {
      const chunk = batchHeights.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map((h) => hiro.getBlockForIndexer(h, blockOptions) as Promise<NewBlockPayload | null>)
      );
      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          fetchedBlocks.push(result.value);
        } else if (result.status === "rejected") {
          logger.warn("Failed to fetch block", { error: String(result.reason) });
        }
      }
    }

    if (fetchedBlocks.length === 0) continue;

    // Sort by height for cleaner inserts
    fetchedBlocks.sort((a, b) => a.block_height - b.block_height);

    // Insert batch
    try {
      await insertBatch(db, fetchedBlocks);
      totalInserted += fetchedBlocks.length;

      const maxHeight = fetchedBlocks[fetchedBlocks.length - 1].block_height;
      progress.lastCompletedHeight = maxHeight;
      progress.updatedAt = new Date().toISOString();
      progress.blocksInserted = totalInserted;
      saveProgress(progress);

      // Progress logging
      const elapsed = (Date.now() - startTime) / 1000;
      const batchElapsed = (Date.now() - batchStart) / 1000;
      const rate = totalInserted / elapsed;
      const remaining = heights.length - (batchIdx + batchHeights.length);
      const eta = remaining / rate;

      logger.info("Batch complete", {
        height: maxHeight,
        inserted: fetchedBlocks.length,
        totalInserted,
        rate: `${rate.toFixed(1)} blocks/sec`,
        batchTime: `${batchElapsed.toFixed(1)}s`,
        remaining,
        eta: `${(eta / 3600).toFixed(1)}h`,
      });

      batchStart = Date.now();
    } catch (err) {
      logger.error("Batch insert failed", {
        heights: `${batchHeights[0]}-${batchHeights[batchHeights.length - 1]}`,
        error: String(err),
      });
      // Continue with next batch — failed blocks will be retried on next run
    }
  }

  await recomputeContiguousAndClose(db);

  const elapsed = (Date.now() - startTime) / 1000;
  logger.info("Bulk backfill complete", {
    totalInserted,
    elapsed: `${(elapsed / 3600).toFixed(2)}h`,
    rate: `${(totalInserted / elapsed).toFixed(1)} blocks/sec`,
  });
}

async function recomputeContiguousAndClose(db: ReturnType<typeof getDb>) {
  logger.info("Recomputing contiguous tip...");

  const { rows: minRows } = await sql<{ min_height: string }>`
    SELECT COALESCE(MIN(height), 0) AS min_height FROM blocks WHERE canonical = true
  `.execute(db);
  const minHeight = Number(minRows[0]?.min_height ?? 0);
  const fromHeight = minHeight > 0 ? minHeight : 1;

  const tip = await computeContiguousTip(db, fromHeight);

  await db
    .updateTable("index_progress")
    .set({ last_contiguous_block: tip, updated_at: new Date() })
    .where("network", "=", NETWORK)
    .execute();

  logger.info("Contiguous tip recomputed", { tip });
  await closeDb();
}

// Run
main().catch((err) => {
  logger.error("Bulk backfill fatal error", { error: err });
  process.exit(1);
});
