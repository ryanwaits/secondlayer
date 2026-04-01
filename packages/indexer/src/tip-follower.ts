import { getDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { StacksNodeClient } from "@secondlayer/shared/node/client";
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

	const timeoutSec = Number.parseInt(process.env.TIP_FOLLOWER_TIMEOUT || "60");
	const checkMs =
		intervalMs ??
		Number.parseInt(process.env.TIP_FOLLOWER_INTERVAL || "10") * 1000;

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
				logger.info(
					"Tip follower: no block for " +
						Math.round(silenceMs / 1000) +
						"s, switching to polling",
				);
			}

			const node = new StacksNodeClient();
			const healthy = await node.isHealthy();
			if (!healthy) {
				logger.warn("Tip follower: stacks-node not reachable, skipping");
				return;
			}

			const nodeInfo = await node.getInfo();
			const chainTip = nodeInfo.stacks_tip_height;
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

			// Log the gap — integrity loop handles actual backfill via archive replay
			const gap = chainTip - ourHeight;
			logger.info("Tip follower: behind chain tip", {
				ourHeight,
				chainTip,
				gap,
			});

			// For small gaps, try replaying from local DB (blocks we already have)
			if (gap <= 10) {
				const indexerUrl = `http://localhost:${process.env.PORT || "3700"}`;
				const localClient = new LocalClient();

				for (let height = ourHeight + 1; height <= chainTip; height++) {
					if ((tipFollowerState as { mode: string }).mode === "normal") break;

					const block = await localClient.getBlockForReplay(db, height);
					if (!block) continue;

					const res = await fetch(`${indexerUrl}/new_block`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"X-Source": "tip-follower-local",
						},
						body: JSON.stringify(block),
					});

					if (res.ok) tipFollowerState.blocksFetchedViaPoll++;
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
