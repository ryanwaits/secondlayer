// Indexer service - receives events from Stacks node
// Uses native Bun.serve routes instead of Hono (fixes stack overflow issues)
import { getDb } from "@secondlayer/shared/db";
import {
	countMissingBlocks,
	findGaps,
} from "@secondlayer/shared/db/queries/integrity";
import type { Gap } from "@secondlayer/shared/db/queries/integrity";
import { logger } from "@secondlayer/shared/logger";
import {
	contractRegistryState,
	startContractRegistry,
} from "./contracts/scheduler.ts";
import {
	bnsMarketplaceEventsPublisherState,
	startBnsMarketplaceEventsPublisher,
} from "./datasets/bns/marketplace-events/scheduler.ts";
import {
	bnsNameEventsPublisherState,
	startBnsNameEventsPublisher,
} from "./datasets/bns/name-events/scheduler.ts";
import {
	bnsNamespaceEventsPublisherState,
	startBnsNamespaceEventsPublisher,
} from "./datasets/bns/namespace-events/scheduler.ts";
import {
	pox4CallsPublisherState,
	startPox4CallsPublisher,
} from "./datasets/pox-4/calls/scheduler.ts";
import {
	sbtcEventsPublisherState,
	startSbtcEventsPublisher,
} from "./datasets/sbtc/events/scheduler.ts";
import {
	sbtcTokenEventsPublisherState,
	startSbtcTokenEventsPublisher,
} from "./datasets/sbtc/token-events/scheduler.ts";
import {
	startStxTransfersPublisher,
	stxTransfersPublisherState,
} from "./datasets/stx-transfers/scheduler.ts";
import {
	getIngestTelemetry,
	ingestNewBlock,
	initIngestState,
} from "./ingest.ts";
import { integrityState, startIntegrityLoop } from "./integrity.ts";
import { persistBurnBlockRewards } from "./l2/burn-rewards-storage.ts";
import {
	INDEXER_LEADER_LOCK_KEY,
	type StopFn,
	withLeaderLock,
} from "./leader.ts";
import {
	startStreamsBulkPublisher,
	streamsBulkPublisherState,
} from "./streams-bulk/scheduler.ts";
import {
	recordBlockReceived,
	startTipFollower,
	tipFollowerState,
} from "./tip-follower.ts";
import type {
	NewBlockPayload,
	NewBurnBlockPayload,
} from "./types/node-events.ts";

const PORT = Number.parseInt(process.env.PORT || "3700");

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
		initIngestState(Number(progress.highest_seen_block));

		const gaps = await findGaps(db, 20);
		const missing = await countMissingBlocks(db);

		if (gaps.length === 0) {
			logger.info("Integrity check passed: no gaps detected");
		} else {
			logger.warn("Integrity check: gaps detected", {
				gapCount: gaps.length,
				totalMissing: missing,
				firstGaps: gaps
					.slice(0, 5)
					.map((g: Gap) => `${g.gapStart}-${g.gapEnd}`),
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

type PublisherStateShape = {
	enabled: boolean;
	publishedTotal: number;
	lastPublishedRange: unknown;
	lastPublishedAt: number;
	lastError: string | null;
};

function publisherStatus(state: PublisherStateShape) {
	return {
		enabled: state.enabled,
		publishedTotal: state.publishedTotal,
		lastPublishedRange: state.lastPublishedRange,
		lastPublishedSecondsAgo:
			state.lastPublishedAt > 0
				? Math.round((Date.now() - state.lastPublishedAt) / 1000)
				: null,
		lastError: state.lastError,
	};
}

const server = Bun.serve({
	port: PORT,

	routes: {
		// Health check
		"/health": () => {
			const ingest = getIngestTelemetry();
			return Response.json({
				status: "ok",
				blocksReceivedOutOfOrder: ingest.blocksReceivedOutOfOrder,
				lastSeenHeight: ingest.lastSeenHeight,
				tipFollower: tipFollowerState.mode,
				lastBlockReceivedSecondsAgo: Math.round(
					(Date.now() - tipFollowerState.lastBlockReceivedAt) / 1000,
				),
				blocksFetchedViaPoll: tipFollowerState.blocksFetchedViaPoll,
				streamsBulkPublisher: {
					enabled: streamsBulkPublisherState.enabled,
					publishedTotal: streamsBulkPublisherState.publishedTotal,
					lastPublishedRange: streamsBulkPublisherState.lastPublishedRange,
					lastPublishedSecondsAgo:
						streamsBulkPublisherState.lastPublishedAt > 0
							? Math.round(
									(Date.now() - streamsBulkPublisherState.lastPublishedAt) /
										1000,
								)
							: null,
					lastError: streamsBulkPublisherState.lastError,
				},
				stxTransfersPublisher: {
					enabled: stxTransfersPublisherState.enabled,
					publishedTotal: stxTransfersPublisherState.publishedTotal,
					lastPublishedRange: stxTransfersPublisherState.lastPublishedRange,
					lastPublishedSecondsAgo:
						stxTransfersPublisherState.lastPublishedAt > 0
							? Math.round(
									(Date.now() - stxTransfersPublisherState.lastPublishedAt) /
										1000,
								)
							: null,
					lastError: stxTransfersPublisherState.lastError,
				},
				sbtcEventsPublisher: {
					enabled: sbtcEventsPublisherState.enabled,
					publishedTotal: sbtcEventsPublisherState.publishedTotal,
					lastPublishedRange: sbtcEventsPublisherState.lastPublishedRange,
					lastPublishedSecondsAgo:
						sbtcEventsPublisherState.lastPublishedAt > 0
							? Math.round(
									(Date.now() - sbtcEventsPublisherState.lastPublishedAt) /
										1000,
								)
							: null,
					lastError: sbtcEventsPublisherState.lastError,
				},
				sbtcTokenEventsPublisher: publisherStatus(
					sbtcTokenEventsPublisherState,
				),
				pox4CallsPublisher: publisherStatus(pox4CallsPublisherState),
				bnsNameEventsPublisher: publisherStatus(bnsNameEventsPublisherState),
				bnsNamespaceEventsPublisher: publisherStatus(
					bnsNamespaceEventsPublisherState,
				),
				bnsMarketplaceEventsPublisher: publisherStatus(
					bnsMarketplaceEventsPublisherState,
				),
				contractRegistry: {
					enabled: contractRegistryState.enabled,
					discoveredTotal: contractRegistryState.discoveredTotal,
					classifiedTotal: contractRegistryState.classifiedTotal,
					failedTotal: contractRegistryState.failedTotal,
					lastRunSecondsAgo:
						contractRegistryState.lastRunAt > 0
							? Math.round(
									(Date.now() - contractRegistryState.lastRunAt) / 1000,
								)
							: null,
					lastError: contractRegistryState.lastError,
				},
			});
		},

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

			// Use live DB data to override stale in-memory gap count
			const gapCount =
				lastContiguousBlock >= lastIndexedBlock ? 0 : integrityState.gapCount;
			const totalMissing =
				lastContiguousBlock >= lastIndexedBlock
					? 0
					: integrityState.totalMissing;

			const status =
				totalMissing === 0
					? "healthy"
					: integrityState.autoBackfillInProgress
						? "degraded"
						: "gaps_detected";

			return Response.json({
				status,
				lastContiguousBlock,
				lastIndexedBlock,
				gapCount,
				totalMissingBlocks: totalMissing,
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
					const result = await ingestNewBlock(payload);
					return Response.json(result);
				} catch (error) {
					logger.error("Error processing new_block", {
						error:
							error instanceof Error
								? { message: error.message, stack: error.stack }
								: error,
					});
					return Response.json(
						{ status: "error", message: String(error) },
						{ status: 500 },
					);
				}
			},
		},

		// New burn block event — persists PoX reward payouts + reward-set
		// membership (the burnchain dataset). Replace-per-height write is
		// idempotent on redelivery and shallow burnchain reorgs.
		"/new_burn_block": {
			POST: async (req) => {
				try {
					const payload = (await req.json()) as NewBurnBlockPayload;
					const { rewards, slots } = await persistBurnBlockRewards(payload);
					logger.debug("Received new burn block", {
						height: payload.burn_block_height,
						hash: payload.burn_block_hash,
						rewards,
						slots,
					});
					return Response.json({ status: "ok" });
				} catch (error) {
					logger.error("Error processing new_burn_block", { error });
					return Response.json(
						{ status: "error", message: String(error) },
						{ status: 500 },
					);
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
		return Response.json(
			{ status: "error", message: "Internal Server Error" },
			{ status: 500 },
		);
	},
});

// Singleton background loops. Each already self-gates on its own
// *_ENABLED flag; they are leader-only because running them on more than one
// instance would double-write. The HTTP server (above) runs on every instance.
function startLeaderLoops(): StopFn {
	const stops = [
		// integrity (gap detection + optional auto-backfill)
		startIntegrityLoop(),
		// tip follower (auto-fallback when the node stops pushing blocks)
		startTipFollower(),
		// dataset publishers (each gated on its own *_PUBLISHER_ENABLED flag)
		startStreamsBulkPublisher(),
		startStxTransfersPublisher(),
		startSbtcEventsPublisher(),
		startSbtcTokenEventsPublisher(),
		startPox4CallsPublisher(),
		startBnsNameEventsPublisher(),
		startBnsNamespaceEventsPublisher(),
		startBnsMarketplaceEventsPublisher(),
		// contract registry (gated on CONTRACT_REGISTRY_ENABLED)
		startContractRegistry(),
	];
	return () => {
		for (const stop of stops.reverse()) stop();
	};
}

// Leader election gates the singleton loops so multiple indexer instances are
// safe to run. Opt-in (default off) — a single instance keeps today's behavior.
const leaderElectionEnabled = process.env.INDEXER_LEADER_ELECTION === "true";
const stopLeaderLoops: () => Promise<void> = leaderElectionEnabled
	? withLeaderLock(INDEXER_LEADER_LOCK_KEY, startLeaderLoops)
	: (() => {
			const stop = startLeaderLoops();
			return async () => {
				await stop();
			};
		})();

// Graceful shutdown
const shutdown = async () => {
	logger.info("Shutting down indexer service...");
	await stopLeaderLoops();
	server.stop();
	logger.info("Indexer service stopped");
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
