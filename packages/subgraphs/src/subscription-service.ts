// Subscription processor service entry point
// Run with: bun run packages/subgraphs/src/subscription-service.ts
//
// Boots ONLY the real-time subscription delivery plane (chain-trigger evaluator,
// outbox emitter, chain-reorg rewind) — isolated from subgraph indexing, so a
// crash-looping or CPU-hot subgraph can't stall webhook delivery, and the plane
// scales out on its own. This is the SOLE booter of the plane (the two-deploy
// cutover is complete; subgraph-processor no longer boots it).
import { assertWebhookSigningConfigured } from "@secondlayer/shared/crypto/secondlayer-webhook";
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
// Fail loud before delivering anything: this plane's whole job is signed webhook
// delivery, so refuse to boot in prod if no signing key is configured (else every
// delivery ships unsigned). Override with ALLOW_UNSIGNED_WEBHOOKS=true.
assertWebhookSigningConfigured();

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
