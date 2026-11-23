import { getSourceDb } from "@secondlayer/shared/db";
import { resolveChainTip } from "@secondlayer/shared/db/queries/integrity";
import { logger } from "@secondlayer/shared/logger";
import { StacksNodeClient } from "@secondlayer/shared/node/client";
import { LocalClient } from "@secondlayer/shared/node/local-client";
import { ingestNewBlock } from "./ingest.ts";
import type { NewBlockPayload } from "./types/node-events.ts";

type TipFollowerMode = "normal" | "polling";

type SourceDb = ReturnType<typeof getSourceDb>;

export const tipFollowerState = {
	mode: "normal" as TipFollowerMode,
	lastBlockReceivedAt: Date.now(),
	blocksFetchedViaPoll: 0,
};

export function recordBlockReceived() {
	tipFollowerState.lastBlockReceivedAt = Date.now();
	if (tipFollowerState.mode === "polling") {
		logger.info("Tip follower: node pushed block, switching to normal mode");
		tipFollowerState.mode = "normal";
	}
}

/** Collaborators of one tip-follower tick; `defaultTipFollowerDeps` wires the production ones. */
export interface TipFollowerDeps {
	timeoutSec: number;
	now: () => number;
	createNode: () => Pick<StacksNodeClient, "isHealthy" | "getInfo">;
	getDb: () => SourceDb;
	resolveOurHeight: (db: SourceDb) => Promise<number | null>;
	createLocalClient: () => Pick<LocalClient, "getBlockForReplay">;
	ingest: (payload: NewBlockPayload) => Promise<unknown>;
}

export function defaultTipFollowerDeps(timeoutSec: number): TipFollowerDeps {
	return {
		timeoutSec,
		now: Date.now,
		createNode: () => new StacksNodeClient(),
		getDb: getSourceDb,
		resolveOurHeight: (db) => resolveChainTip(db, "seen"),
		createLocalClient: () => new LocalClient(),
		ingest: ingestNewBlock,
	};
}

/** Returns the tick `startTipFollower` runs on its interval; overlapping calls are skipped while one is in flight. */
export function createTipFollowerTick(
	deps: TipFollowerDeps,
): () => Promise<void> {
	let running = false;

	return async function tick() {
		const silenceMs = deps.now() - tipFollowerState.lastBlockReceivedAt;
		if (silenceMs < deps.timeoutSec * 1000) return;
		if (running) return;

		running = true;
		try {
			if (tipFollowerState.mode !== "polling") {
				tipFollowerState.mode = "polling";
				logger.info(
					`Tip follower: no block for ${Math.round(silenceMs / 1000)}s, switching to polling`,
				);
			}

			const node = deps.createNode();
			const healthy = await node.isHealthy();
			if (!healthy) {
				logger.warn("Tip follower: stacks-node not reachable, skipping");
				return;
			}

			const nodeInfo = await node.getInfo();
			const chainTip = nodeInfo.stacks_tip_height;
			if (!chainTip) return;

			const db = deps.getDb();
			const ourHeight = (await deps.resolveOurHeight(db)) ?? 0;
			if (chainTip <= ourHeight) return;

			const gap = chainTip - ourHeight;
			logger.info("Tip follower: behind chain tip", {
				ourHeight,
				chainTip,
				gap,
			});

			if (gap <= 10) {
				const localClient = deps.createLocalClient();

				for (let height = ourHeight + 1; height <= chainTip; height++) {
					if ((tipFollowerState as { mode: string }).mode === "normal") break;

					const block = await localClient.getBlockForReplay(db, height);
					if (!block) continue;

					try {
						await deps.ingest(block as unknown as NewBlockPayload);
						tipFollowerState.blocksFetchedViaPoll++;
					} catch (err) {
						logger.warn("Tip follower: in-process ingest failed", {
							height,
							error: err,
						});
					}
				}
			}
		} catch (err) {
			logger.error("Tip follower tick failed", { error: err });
		} finally {
			running = false;
		}
	};
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

	const tick = createTipFollowerTick(defaultTipFollowerDeps(timeoutSec));
	const timer = setInterval(tick, checkMs);

	return () => {
		clearInterval(timer);
		logger.info("Tip follower stopped");
	};
}
