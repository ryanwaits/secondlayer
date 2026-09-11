// Subgraph processor service entry point
// Run with: bun run packages/subgraphs/src/service.ts
import { assertDbSplit, getDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { isPlatformMode } from "@secondlayer/shared/mode";
import { sql } from "kysely";
import { setHostedMeterHooks } from "./runtime/hosted-meter.ts";
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

assertDbSplit();

if (isPlatformMode()) {
	try {
		const spec = "@secondlayer/platform/hosted-meters";
		const mod = (await import(spec)) as {
			onBlocksProcessed: (accountId: string, blocks: number) => Promise<void>;
			onDeliveryAttempt: (accountId: string) => Promise<void>;
		};
		setHostedMeterHooks({
			onBlocksProcessed: mod.onBlocksProcessed,
			onDeliveryAttempt: mod.onDeliveryAttempt,
		});
	} catch (err) {
		logger.warn("hosted meters not installed; indexing unmetered", {
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
