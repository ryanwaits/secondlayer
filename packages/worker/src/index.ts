// Worker service - scheduled jobs only (stream processing removed)
import { getEnv, logger } from "@secondlayer/shared";
import { startStorageMeasurement } from "./jobs/measure-storage.ts";

let running = true;

/**
 * Main worker loop - runs scheduled background jobs only
 * 
 * NOTE: Stream processing has been removed as part of the streams deprecation.
 * The worker now only runs periodic scheduled jobs:
 * - Storage measurement (subgraph storage tracking)
 */
async function runWorker() {
	const env = getEnv();
	logger.info("Starting worker (scheduled jobs only)", {
		networks: env.enabledNetworks,
	});

	// Start periodic storage measurement
	const stopStorageMeasurement = startStorageMeasurement();

	logger.info("Worker ready - running scheduled jobs");

	// Handle shutdown
	const shutdown = async () => {
		if (!running) return;
		running = false;

		logger.info("Shutting down worker...");

		stopStorageMeasurement();

		logger.info("Worker shutdown complete");
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

// Start the worker
runWorker().catch((error) => {
	logger.error("Worker failed to start", { error });
	process.exit(1);
});
