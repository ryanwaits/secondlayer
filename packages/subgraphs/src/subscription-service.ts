// Subscription processor service entry point
// Run with: bun run packages/subgraphs/src/subscription-service.ts
//
// Boots ONLY the real-time subscription delivery plane (chain-trigger evaluator,
// outbox emitter, chain-reorg rewind) — isolated from subgraph indexing, so a
// crash-looping or CPU-hot subgraph can't stall webhook delivery, and the plane
// scales out on its own. The subgraph-processor still boots the same plane until
// the two-deploy cutover removes it there.
import { assertDbSplit, getDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { sql } from "kysely";
import { startSubscriptionPlane } from "./runtime/subscription-plane.ts";

const HEARTBEAT_INTERVAL_MS = 30_000;
const SERVICE_NAME = "subscription-processor";

async function writeHeartbeat(): Promise<void> {
	try {
		await getDb()
			.insertInto("service_heartbeats")
			.values({ name: SERVICE_NAME })
			.onConflict((oc) =>
				oc.column("name").doUpdateSet({ updated_at: sql`now()` }),
			)
			.execute();
	} catch (err) {
		logger.warn("subscription-processor heartbeat write failed", {
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

assertDbSplit();

const stopPlane = await startSubscriptionPlane();

await writeHeartbeat();
const heartbeatInterval = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);

const shutdown = async () => {
	logger.info("Shutting down subscription processor...");
	clearInterval(heartbeatInterval);
	await stopPlane();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
