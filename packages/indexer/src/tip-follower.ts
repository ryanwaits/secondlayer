import { getDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { HiroClient } from "@secondlayer/shared/node/hiro-client";

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

      const ourHeight = progress?.highest_seen_block ?? 0;
      if (chainTip <= ourHeight) return;

      const indexerUrl = `http://localhost:${process.env.PORT || "3700"}`;

      logger.info("Tip follower: fetching missing blocks", {
        from: ourHeight + 1,
        to: chainTip,
        count: chainTip - ourHeight,
      });

      for (let height = ourHeight + 1; height <= chainTip; height++) {
        // Check if node came back while we're polling (read dynamically — mode may change via recordBlockReceived)
        if ((tipFollowerState as { mode: string }).mode === "normal") {
          logger.info("Tip follower: node resumed, stopping poll fetch");
          break;
        }

        try {
          const block = await hiro.getBlockForIndexer(height, { includeRawTx: true });
          if (!block) {
            logger.warn("Tip follower: block not found", { height });
            continue;
          }

          const res = await fetch(`${indexerUrl}/new_block`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Source": "tip-follower",
            },
            body: JSON.stringify(block),
          });

          if (!res.ok) {
            logger.warn("Tip follower: indexer rejected block", { height, status: res.status });
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
