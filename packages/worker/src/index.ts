import { getEnv, logger } from "@secondlayer/shared";
import { assertDbSplit } from "@secondlayer/shared/db";
import { startComputeMeteringCron } from "./jobs/compute-metering.ts";
import { startStorageMeasurement } from "./jobs/measure-storage.ts";
import { startSpendCapAlertCron } from "./jobs/spend-cap-alert.ts";
import { startStorageMeteringCron } from "./jobs/storage-metering.ts";
import { startX402ReconcileCron } from "./jobs/x402-reconcile.ts";

let running = true;

async function runWorker() {
	assertDbSplit();
	const env = getEnv();
	logger.info("Starting worker", { networks: env.enabledNetworks });

	const stops = [
		startStorageMeasurement(),
		startComputeMeteringCron(),
		startStorageMeteringCron(),
		startSpendCapAlertCron(),
		startX402ReconcileCron(),
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
