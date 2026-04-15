import { getEnv, logger } from "@secondlayer/shared";
import { startStorageMeasurement } from "./jobs/measure-storage.ts";

let running = true;

async function runWorker() {
	const env = getEnv();
	logger.info("Starting worker", { networks: env.enabledNetworks });

	const stopStorageMeasurement = startStorageMeasurement();

	logger.info("Worker ready");

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

runWorker().catch((error) => {
	logger.error("Worker failed to start", { error });
	process.exit(1);
});
