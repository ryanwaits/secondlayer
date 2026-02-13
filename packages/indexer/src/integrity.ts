import { getDb, sql } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { findGaps, countMissingBlocks, computeContiguousTip } from "@secondlayer/shared/db/queries/integrity";
import { HiroClient } from "@secondlayer/shared/node/hiro-client";
import type { Gap } from "@secondlayer/shared/db/queries/integrity";

// Auto-backfill state (visible to /health/integrity)
export const integrityState = {
  lastCheckAt: null as Date | null,
  gapCount: 0,
  totalMissing: 0,
  gaps: [] as Gap[],
  autoBackfillEnabled: process.env.AUTO_BACKFILL !== "false",
  autoBackfillInProgress: false,
  autoBackfillRemaining: 0,
};

// Track when gaps were first seen (for 5-min cooldown)
const gapFirstSeen = new Map<string, Date>();

function gapKey(gap: Gap): string {
  return `${gap.gapStart}-${gap.gapEnd}`;
}

async function runIntegrityCheck() {
  try {
    const db = getDb();
    const gaps = await findGaps(db, 100);
    const missing = await countMissingBlocks(db);

    integrityState.lastCheckAt = new Date();
    integrityState.gapCount = gaps.length;
    integrityState.totalMissing = missing;
    integrityState.gaps = gaps;

    // Always reconcile last_contiguous_block from actual data
    await recomputeContiguous(db);

    if (gaps.length === 0) {
      gapFirstSeen.clear();
      logger.debug("Integrity check: no gaps");
      return;
    }

    // Track when gaps were first seen
    const currentKeys = new Set<string>();
    for (const gap of gaps) {
      const key = gapKey(gap);
      currentKeys.add(key);
      if (!gapFirstSeen.has(key)) {
        gapFirstSeen.set(key, new Date());
      }
    }
    // Clean up gaps that no longer exist
    for (const key of gapFirstSeen.keys()) {
      if (!currentKeys.has(key)) {
        gapFirstSeen.delete(key);
      }
    }

    logger.info("Integrity check: gaps detected", {
      gapCount: gaps.length,
      totalMissing: missing,
      ranges: gaps.slice(0, 5).map((g) => `${g.gapStart}-${g.gapEnd}`),
    });

    // Task 4.2: Auto-backfill if enabled
    if (integrityState.autoBackfillEnabled) {
      await autoBackfill(gaps);
    }
  } catch (err) {
    logger.error("Integrity check failed", { error: err });
  }
}

async function recomputeContiguous(db: ReturnType<typeof getDb>) {
  const network = process.env.STACKS_NETWORK || "mainnet";

  // Find the lowest block we have — supports indexing from arbitrary start height
  const { rows: minRows } = await sql<{ min_height: string }>`
    SELECT COALESCE(MIN(height), 0) AS min_height FROM blocks WHERE canonical = true
  `.execute(db);
  const minHeight = Number(minRows[0]?.min_height ?? 0);
  const fromHeight = minHeight > 0 ? minHeight : 1;

  const tip = await computeContiguousTip(db, fromHeight);

  await db
    .updateTable("index_progress")
    .set({ last_contiguous_block: tip, updated_at: new Date() })
    .where("network", "=", network)
    .execute();

  logger.info("Recomputed last_contiguous_block", { tip });
}

async function autoBackfill(gaps: Gap[]) {
  if (integrityState.autoBackfillInProgress) {
    logger.debug("Auto-backfill already in progress, skipping");
    return;
  }

  const now = new Date();
  const cooldownMs = 5 * 60 * 1000; // 5 minutes

  // Only fill gaps that have been seen for >5 minutes
  const staleGaps = gaps.filter((gap) => {
    const firstSeen = gapFirstSeen.get(gapKey(gap));
    return firstSeen && now.getTime() - firstSeen.getTime() > cooldownMs;
  });

  if (staleGaps.length === 0) {
    logger.debug("No stale gaps to backfill (all < 5 min old)");
    return;
  }

  const totalBlocks = staleGaps.reduce((sum, g) => sum + g.size, 0);
  integrityState.autoBackfillInProgress = true;
  integrityState.autoBackfillRemaining = totalBlocks;

  logger.info("Auto-backfill starting", {
    gaps: staleGaps.length,
    blocks: totalBlocks,
  });

  const hiroClient = new HiroClient();
  const indexerUrl = `http://localhost:${process.env.PORT || "3700"}`;
  const blocksPerSecond = parseInt(process.env.AUTO_BACKFILL_RATE || "10");

  try {
    const hiroHealthy = await hiroClient.isHealthy();
    if (!hiroHealthy) {
      logger.warn("Auto-backfill: Hiro API not reachable, skipping");
      return;
    }

    for (const gap of staleGaps) {
      for (let height = gap.gapStart; height <= gap.gapEnd; height++) {
        try {
          const block = await hiroClient.getBlockForIndexer(height, {
            includeRawTx: process.env.BACKFILL_INCLUDE_RAW_TX === "true",
          });

          if (!block) {
            logger.warn("Auto-backfill: block not found", { height });
            continue;
          }

          const res = await fetch(`${indexerUrl}/new_block`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Source": "auto-backfill",
            },
            body: JSON.stringify(block),
          });

          if (!res.ok) {
            logger.warn("Auto-backfill: indexer rejected block", {
              height,
              status: res.status,
            });
          }

          integrityState.autoBackfillRemaining--;

          // Rate limit: sleep to maintain blocks/second rate
          await Bun.sleep(1000 / blocksPerSecond);
        } catch (err) {
          logger.warn("Auto-backfill: error fetching block", { height, error: err });
        }
      }
    }

    // Recompute contiguous immediately so views can advance
    await recomputeContiguous(getDb());
    logger.info("Auto-backfill complete", { blocks: totalBlocks });
  } catch (err) {
    logger.error("Auto-backfill failed", { error: err });
  } finally {
    integrityState.autoBackfillInProgress = false;
    integrityState.autoBackfillRemaining = 0;
  }
}

export function startIntegrityLoop(intervalMs = 300_000): () => void {
  logger.info("Starting integrity loop", {
    intervalMs,
    autoBackfill: integrityState.autoBackfillEnabled,
  });

  // Run immediately on start
  runIntegrityCheck();

  const timer = setInterval(runIntegrityCheck, intervalMs);

  return () => {
    clearInterval(timer);
    logger.info("Integrity loop stopped");
  };
}
