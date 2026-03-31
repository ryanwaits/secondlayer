import { getDb, sql } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { findGaps, countMissingBlocks, computeContiguousTip } from "@secondlayer/shared/db/queries/integrity";
import { LocalClient } from "@secondlayer/shared/node/local-client";
import { HiroClient } from "@secondlayer/shared/node/hiro-client";
import type { Gap } from "@secondlayer/shared/db/queries/integrity";

// Auto-backfill state (visible to /health/integrity)
export const integrityState = {
  lastCheckAt: null as Date | null,
  gapCount: 0,
  totalMissing: 0,
  gaps: [] as Gap[],
  autoBackfillEnabled: process.env.AUTO_BACKFILL_ENABLED !== "false",
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
      ranges: gaps.slice(0, 5).map((g: Gap) => `${g.gapStart}-${g.gapEnd}`),
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

  const localClient = new LocalClient();
  const indexerUrl = `http://localhost:${process.env.PORT || "3700"}`;
  const db = getDb();

  try {
    // Phase 1: Try local DB for each gap height (reprocessing/replays)
    const remainingHeights = new Set<number>();
    for (const gap of staleGaps) {
      for (let height = gap.gapStart; height <= gap.gapEnd; height++) {
        const block = await localClient.getBlockForReplay(db, height);
        if (block) {
          const res = await fetch(`${indexerUrl}/new_block`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Source": "auto-backfill-local",
            },
            body: JSON.stringify(block),
          });
          if (res.ok) {
            integrityState.autoBackfillRemaining--;
          }
        } else {
          remainingHeights.add(height);
        }
      }
    }

    if (remainingHeights.size === 0) {
      await recomputeContiguous(getDb());
      logger.info("Auto-backfill complete (all from local)", { blocks: totalBlocks });
      return;
    }

    // Phase 2: Hiro API for remaining blocks
    let hiroFilled = 0;
    if (remainingHeights.size > 0) {
      logger.info("Auto-backfill: fetching from Hiro API", {
        remaining: remainingHeights.size,
      });

      const hiroClient = new HiroClient();
      const hiroHealthy = await hiroClient.isHealthy();

      if (hiroHealthy) {
        for (const h of remainingHeights) {
          try {
            const payload = await hiroClient.getBlockForIndexer(h, { includeRawTx: true });
            if (!payload) continue;

            const res = await fetch(`${indexerUrl}/new_block`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Source": "auto-backfill-hiro",
              },
              body: JSON.stringify(payload),
            });

            if (res.ok) {
              hiroFilled++;
              integrityState.autoBackfillRemaining--;
            } else {
              logger.warn("Auto-backfill: Hiro block rejected by indexer", { height: h, status: res.status });
            }
          } catch (err) {
            logger.warn("Auto-backfill: Hiro API fetch failed", { height: h, error: String(err) });
          }
        }
      } else {
        logger.warn("Auto-backfill: Hiro API not reachable");
      }
    }

    await recomputeContiguous(getDb());
    logger.info("Auto-backfill complete", {
      blocks: totalBlocks,
      fromLocal: totalBlocks - remainingHeights.size,
      fromHiro: hiroFilled,
    });
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
