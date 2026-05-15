// Subgraph processor service entry point
// Run with: bun run packages/subgraphs/src/service.ts
import { getDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { sql } from "kysely";
import { startSubgraphProcessor } from "./runtime/processor.ts";

const HEARTBEAT_INTERVAL_MS = 30_000;
const SERVICE_NAME = "subgraph-processor";

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
		logger.warn("subgraph-processor heartbeat write failed", {
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

const processor = await startSubgraphProcessor({
	concurrency: Number.parseInt(process.env.SUBGRAPH_CONCURRENCY ?? "5"),
});

await writeHeartbeat();
const heartbeatInterval = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);

// Graceful shutdown
const shutdown = async () => {
	logger.info("Shutting down subgraph processor...");
	clearInterval(heartbeatInterval);
	await processor();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
