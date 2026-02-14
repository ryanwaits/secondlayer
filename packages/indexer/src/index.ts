// Indexer service - receives events from Stacks node
// Uses native Bun.serve routes instead of Hono (fixes stack overflow issues)
import { getDb } from "@secondlayer/shared/db";
import { sql } from "@secondlayer/shared";
import { logger } from "@secondlayer/shared/logger";
import { enqueue } from "@secondlayer/shared/queue";
import { notifyNewJob } from "@secondlayer/shared/queue/listener";
import { parseBlock, parseTransaction, parseEvent } from "./parser.ts";
import { detectReorg, handleReorg } from "./reorg.ts";
import { computeContiguousTip, findGaps, countMissingBlocks } from "@secondlayer/shared/db/queries/integrity";
import { startIntegrityLoop, integrityState } from "./integrity.ts";
import { recordBlockReceived, startTipFollower, tipFollowerState } from "./tip-follower.ts";
import type { NewBlockPayload, NewBurnBlockPayload } from "./types/node-events.ts";

const PORT = parseInt(process.env.PORT || "3700");

// Task 2.3: Out-of-order block counter (ephemeral, resets on restart)
let lastSeenHeight = 0;
let blocksReceivedOutOfOrder = 0;

// Task 2.2: Startup integrity check
async function runStartupIntegrityCheck() {
  try {
    const db = getDb();
    const network = process.env.STACKS_NETWORK || "mainnet";

    const progress = await db
      .selectFrom("index_progress")
      .selectAll()
      .where("network", "=", network)
      .limit(1)
      .executeTakeFirst();

    if (!progress) {
      logger.info("No index progress found, starting fresh");
      return;
    }

    logger.info("Startup integrity check", {
      network,
      lastContiguousBlock: progress.last_contiguous_block,
      lastIndexedBlock: progress.last_indexed_block,
      highestSeenBlock: progress.highest_seen_block,
    });

    // Initialize lastSeenHeight for out-of-order tracking
    lastSeenHeight = progress.highest_seen_block;

    const gaps = await findGaps(db, 20);
    const missing = await countMissingBlocks(db);

    if (gaps.length === 0) {
      logger.info("Integrity check passed: no gaps detected");
    } else {
      logger.warn("Integrity check: gaps detected", {
        gapCount: gaps.length,
        totalMissing: missing,
        firstGaps: gaps.slice(0, 5).map((g) => `${g.gapStart}-${g.gapEnd}`),
      });

      if (process.env.REQUIRE_INTEGRITY === "true") {
        logger.error("REQUIRE_INTEGRITY is set — exiting due to gaps");
        process.exit(1);
      }
    }
  } catch (err) {
    logger.error("Startup integrity check failed", { error: err });
  }
}

await runStartupIntegrityCheck();

logger.info("Starting indexer service", { port: PORT });

const server = Bun.serve({
  port: PORT,

  routes: {
    // Health check
    "/health": () => Response.json({
      status: "ok",
      blocksReceivedOutOfOrder,
      lastSeenHeight,
      tipFollower: tipFollowerState.mode,
      lastBlockReceivedSecondsAgo: Math.round((Date.now() - tipFollowerState.lastBlockReceivedAt) / 1000),
      blocksFetchedViaPoll: tipFollowerState.blocksFetchedViaPoll,
    }),

    "/health/integrity": async () => {
      const db = getDb();
      const network = process.env.STACKS_NETWORK || "mainnet";

      let lastContiguousBlock = 0;
      let lastIndexedBlock = 0;
      try {
        const row = await db
          .selectFrom("index_progress")
          .selectAll()
          .where("network", "=", network)
          .limit(1)
          .executeTakeFirst();
        if (row) {
          lastContiguousBlock = row.last_contiguous_block;
          lastIndexedBlock = row.last_indexed_block;
        }
      } catch {
        // DB unavailable
      }

      const status = integrityState.totalMissing === 0
        ? "healthy"
        : integrityState.autoBackfillInProgress
          ? "degraded"
          : "gaps_detected";

      return Response.json({
        status,
        lastContiguousBlock,
        lastIndexedBlock,
        gapCount: integrityState.gapCount,
        totalMissingBlocks: integrityState.totalMissing,
        autoBackfillEnabled: integrityState.autoBackfillEnabled,
        autoBackfillProgress: {
          remaining: integrityState.autoBackfillRemaining,
          inProgress: integrityState.autoBackfillInProgress,
        },
      });
    },

    // New block event
    "/new_block": {
      POST: async (req) => {
        try {
          // Skip recording for self-sourced blocks (tip-follower, auto-backfill)
          const source = req.headers.get("X-Source");
          if (!source) recordBlockReceived();

          const payload = (await req.json()) as NewBlockPayload;
          const db = getDb();

          logger.info("Received new block", {
            height: payload.block_height,
            hash: payload.block_hash,
          });

          // Detect reorganization
          const reorgCheck = await detectReorg(payload.block_height, payload.block_hash);

          if (reorgCheck.isReorg && reorgCheck.oldHash) {
            await handleReorg(payload.block_height, reorgCheck.oldHash, payload.block_hash);
          } else {
            // Check for duplicate — only skip if already canonical
            const existing = await db
              .selectFrom("blocks")
              .selectAll()
              .where("height", "=", payload.block_height)
              .where("hash", "=", payload.block_hash)
              .where("canonical", "=", true)
              .limit(1)
              .execute();

            if (existing.length > 0) {
              logger.debug("Duplicate block, skipping", { height: payload.block_height });
              return Response.json({ status: "ok", message: "duplicate" });
            }
          }

          // Task 2.3: Track out-of-order blocks
          if (lastSeenHeight > 0 && payload.block_height < lastSeenHeight) {
            blocksReceivedOutOfOrder++;
            logger.debug("Block received out of order", {
              height: payload.block_height,
              lastSeen: lastSeenHeight,
              outOfOrderCount: blocksReceivedOutOfOrder,
            });
          }
          if (payload.block_height > lastSeenHeight) {
            lastSeenHeight = payload.block_height;
          }

          // Task 2.1: Parent hash validation
          if (payload.block_height > 1) {
            const parentRow = await db
              .selectFrom("blocks")
              .select("hash")
              .where("height", "=", payload.block_height - 1)
              .where("canonical", "=", true)
              .limit(1)
              .executeTakeFirst();

            if (!parentRow) {
              logger.warn("Missing parent block", {
                height: payload.block_height,
                parentHeight: payload.block_height - 1,
              });
            } else if (parentRow.hash !== payload.parent_block_hash) {
              logger.warn("Parent hash mismatch", {
                height: payload.block_height,
                expectedParent: payload.parent_block_hash,
                storedParent: parentRow.hash,
              });
            }
          }

          // Parse block data
          const block = parseBlock(payload);
          const txResults = await Promise.all(
            payload.transactions.map((tx) => parseTransaction(tx, payload.block_height))
          );
          const txs = txResults.filter((tx): tx is NonNullable<typeof tx> => tx !== null);

          const evts = payload.events
            .map((evt) => parseEvent(evt, payload.block_height))
            .filter((evt): evt is NonNullable<typeof evt> => evt !== null);

          // Insert in transaction (chunk large batches to avoid Postgres parameter limit)
          const TX_CHUNK_SIZE = 500;
          const EVT_CHUNK_SIZE = 1000;

          await db.transaction().execute(async (tx) => {
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
                }),
              )
              .execute();

            for (let i = 0; i < txs.length; i += TX_CHUNK_SIZE) {
              await tx
                .insertInto("transactions")
                .values(txs.slice(i, i + TX_CHUNK_SIZE))
                .onConflict((oc) => oc.doNothing())
                .execute();
            }

            for (let i = 0; i < evts.length; i += EVT_CHUNK_SIZE) {
              await tx
                .insertInto("events")
                .values(evts.slice(i, i + EVT_CHUNK_SIZE))
                .onConflict((oc) => oc.doNothing())
                .execute();
            }

            const network = process.env.STACKS_NETWORK || "mainnet";

            // Compute lastContiguousBlock
            const progressRow = await tx
              .selectFrom("index_progress")
              .select("last_contiguous_block")
              .where("network", "=", network)
              .limit(1)
              .executeTakeFirst();

            const currentContiguous = Number(progressRow?.last_contiguous_block ?? 0);
            let newContiguous = currentContiguous;

            if (payload.block_height === currentContiguous + 1) {
              // Next sequential block — extend the contiguous chain
              newContiguous = await computeContiguousTip(tx, currentContiguous + 1);
            } else if (currentContiguous === 0 && payload.block_height > 1) {
              // Indexing from non-genesis start — find contiguous run from our lowest block
              const { rows: minRows } = await sql<{ min_height: string }>`
                SELECT MIN(height) AS min_height FROM blocks WHERE canonical = true
              `.execute(tx);
              const minHeight = Number(minRows[0]?.min_height ?? 0);
              if (minHeight > 0) {
                newContiguous = await computeContiguousTip(tx, minHeight);
              }
            }

            await tx
              .insertInto("index_progress")
              .values({
                network,
                last_indexed_block: payload.block_height,
                last_contiguous_block: newContiguous,
                highest_seen_block: payload.block_height,
              })
              .onConflict((oc) =>
                oc.column("network").doUpdateSet({
                  last_indexed_block: sql`GREATEST(index_progress.last_indexed_block, ${payload.block_height})`,
                  last_contiguous_block: sql`GREATEST(index_progress.last_contiguous_block, ${newContiguous})`,
                  highest_seen_block: sql`GREATEST(index_progress.highest_seen_block, ${payload.block_height})`,
                  updated_at: new Date(),
                }),
              )
              .execute();
          });

          logger.info("Block indexed successfully", {
            height: payload.block_height,
            transactions: txs.length,
            events: evts.length,
          });

          // Enqueue jobs for active streams
          const activeStreams = await db
            .selectFrom("streams")
            .select("id")
            .where("status", "=", "active")
            .execute();

          let jobsEnqueued = 0;
          for (const stream of activeStreams) {
            await enqueue(stream.id, payload.block_height);
            jobsEnqueued++;
          }

          if (jobsEnqueued > 0) {
            await notifyNewJob().catch((err) => {
              logger.warn("Failed to notify workers", { error: err });
            });

            logger.debug("Enqueued jobs for streams", {
              count: jobsEnqueued,
              blockHeight: payload.block_height,
            });
          }

          return Response.json({
            status: "ok",
            block_height: payload.block_height,
            transactions: txs.length,
            events: evts.length,
            jobs_enqueued: jobsEnqueued,
          });
        } catch (error) {
          logger.error("Error processing new_block", { error });
          return Response.json({ status: "error", message: String(error) }, { status: 500 });
        }
      },
    },

    // New burn block event (log only)
    "/new_burn_block": {
      POST: async (req) => {
        try {
          const payload = (await req.json()) as NewBurnBlockPayload;
          logger.debug("Received new burn block", {
            height: payload.burn_block_height,
            hash: payload.burn_block_hash,
          });
          return Response.json({ status: "ok" });
        } catch (error) {
          logger.error("Error processing new_burn_block", { error });
          return Response.json({ status: "error", message: String(error) }, { status: 500 });
        }
      },
    },

    // Mempool events (no-op for v1)
    "/new_mempool_tx": {
      POST: () => Response.json({ status: "ok" }),
    },

    "/drop_mempool_tx": {
      POST: () => Response.json({ status: "ok" }),
    },

    // Atlas attachments (no-op, required by Stacks node event dispatcher)
    "/attachments/new": {
      POST: () => Response.json({ status: "ok" }),
    },
  },

  // Fallback for unmatched routes
  fetch(_req) {
    return new Response("Not Found", { status: 404 });
  },

  // Global error handler
  error(error) {
    logger.error("Unhandled server error", { error });
    return Response.json({ status: "error", message: "Internal Server Error" }, { status: 500 });
  },
});

// Start integrity loop (gap detection + optional auto-backfill)
const stopIntegrityLoop = startIntegrityLoop();

// Start tip follower (auto-fallback when node stops pushing blocks)
const stopTipFollower = startTipFollower();

// Graceful shutdown
const shutdown = () => {
  logger.info("Shutting down indexer service...");
  stopTipFollower();
  stopIntegrityLoop();
  server.stop();
  logger.info("Indexer service stopped");
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
