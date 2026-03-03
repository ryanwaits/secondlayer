import { getDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { HiroClient } from "@secondlayer/shared/node/hiro-client";
import { LocalClient } from "@secondlayer/shared/node/local-client";

type TipFollowerMode = "normal" | "polling";

export const tipFollowerState = {
  mode: "normal" as TipFollowerMode,
  lastBlockReceivedAt: Date.now(),
  blocksFetchedViaPoll: 0,
};

/** Called from /new_block handler — resets silence timer, flips back to normal */
export function recordBlockReceived() {
  tipFollowerState.lastBlockReceivedAt = Date.now();
  if (tipFollowerState.mode === "polling") {
    logger.info("Tip follower: node pushed block, switching to normal mode");
    tipFollowerState.mode = "normal";
  }
}

export function startTipFollower(intervalMs?: number): () => void {
  const enabled = process.env.TIP_FOLLOWER_ENABLED !== "false";
  if (!enabled) {
    logger.info("Tip follower disabled");
    return () => {};
  }

  const timeoutSec = parseInt(process.env.TIP_FOLLOWER_TIMEOUT || "60");
  const checkMs = intervalMs ?? parseInt(process.env.TIP_FOLLOWER_INTERVAL || "10") * 1000;

  logger.info("Starting tip follower", { timeoutSec, checkMs });

  let running = false;

  async function tick() {
    const silenceMs = Date.now() - tipFollowerState.lastBlockReceivedAt;
    if (silenceMs < timeoutSec * 1000) return;
    if (running) return;

    running = true;
    try {
      if (tipFollowerState.mode !== "polling") {
        tipFollowerState.mode = "polling";
        logger.info("Tip follower: no block for " + Math.round(silenceMs / 1000) + "s, switching to polling");
      }

      const hiro = new HiroClient();
      const healthy = await hiro.isHealthy();
      if (!healthy) {
        logger.warn("Tip follower: Hiro API not reachable, skipping");
        return;
      }

      const chainTip = await hiro.fetchChainTip();
      if (!chainTip) return;

      const db = getDb();
      const network = process.env.STACKS_NETWORK || "mainnet";
      const progress = await db
        .selectFrom("index_progress")
        .select("highest_seen_block")
        .where("network", "=", network)
        .limit(1)
        .executeTakeFirst();

      const ourHeight = Number(progress?.highest_seen_block ?? 0);
      if (chainTip <= ourHeight) return;

      // Only fetch a small window near the tip — bulk gaps are handled by integrity/backfill
      const maxBlocks = parseInt(process.env.TIP_FOLLOWER_MAX_BLOCKS || "10");
      const fetchFrom = Math.max(ourHeight + 1, chainTip - maxBlocks + 1);

      if (fetchFrom > ourHeight + 1) {
        logger.info("Tip follower: gap too large, only fetching recent tip blocks", {
          gap: chainTip - ourHeight,
          fetching: chainTip - fetchFrom + 1,
        });
      }

      const indexerUrl = `http://localhost:${process.env.PORT || "3700"}`;
      const localClient = new LocalClient();

      logger.info("Tip follower: fetching missing blocks", {
        from: fetchFrom,
        to: chainTip,
        count: chainTip - fetchFrom + 1,
      });

      for (let height = fetchFrom; height <= chainTip; height++) {
        // Check if node came back while we're polling
        if ((tipFollowerState as { mode: string }).mode === "normal") {
          logger.info("Tip follower: node resumed, stopping poll fetch");
          break;
        }

        try {
          // Try local DB first (for re-orgs / reprocessing)
          let block = await localClient.getBlockForReplay(db, height);
          let source = "local";

          if (!block) {
            // Fall back to remote Hiro API
            const hiroBlock = await hiro.getBlockForIndexer(height, { includeRawTx: true });
            block = hiroBlock as typeof block;
            source = "hiro";
          }

          if (!block) {
            logger.warn("Tip follower: block not found", { height });
            continue;
          }

          const res = await fetch(`${indexerUrl}/new_block`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Source": `tip-follower-${source}`,
            },
            body: JSON.stringify(block),
          });

          if (!res.ok) {
            logger.warn("Tip follower: indexer rejected block", { height, status: res.status, source });
          } else {
            tipFollowerState.blocksFetchedViaPoll++;
          }
        } catch (err) {
          logger.warn("Tip follower: error fetching block", { height, error: err });
        }
      }
    } catch (err) {
      logger.error("Tip follower tick failed", { error: err });
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, checkMs);

  return () => {
    clearInterval(timer);
    logger.info("Tip follower stopped");
  };
}
