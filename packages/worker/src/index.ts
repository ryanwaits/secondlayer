import { getEnv, logger } from "@secondlayer/shared";
import { assertDbSplit } from "@secondlayer/shared/db";
import { startBalanceAlertCron } from "./jobs/balance-alert.ts";
import { startCreditsRefillCron } from "./jobs/credits-refill.ts";
import { startFailedRequestsPurgeCron } from "./jobs/failed-requests-purge.ts";
import { startFeedbackClassifyCron } from "./jobs/feedback-classify.ts";
import { startSpendCapAlertCron } from "./jobs/spend-cap-alert.ts";

let running = true;

async function runWorker() {
	assertDbSplit();
	const env = getEnv();
	logger.info("Starting worker", { networks: env.enabledNetworks });

	const stops = [
		startSpendCapAlertCron(),
		startCreditsRefillCron(),
		startBalanceAlertCron(),
		startFailedRequestsPurgeCron(),
		startFeedbackClassifyCron(),
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
