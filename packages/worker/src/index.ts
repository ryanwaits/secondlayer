import { getEnv, logger } from "@secondlayer/shared";
import { startStorageMeasurement } from "./jobs/measure-storage.ts";
import { startTenantHealthCron } from "./jobs/tenant-health.ts";
import { startTenantIdlePauseCron } from "./jobs/tenant-idle-pause.ts";

let running = true;

async function runWorker() {
	const env = getEnv();
	logger.info("Starting worker", { networks: env.enabledNetworks });

	const stops = [
		startStorageMeasurement(),
		startTenantHealthCron(),
		startTenantIdlePauseCron(),
	];

	logger.info("Worker ready");

	const shutdown = async () => {
		if (!running) return;
		running = false;

		logger.info("Shutting down worker...");
		for (const stop of stops) stop();
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
