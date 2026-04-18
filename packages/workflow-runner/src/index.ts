import { logger } from "@secondlayer/shared/logger";
import { startBudgetResetCron } from "./budget/reset-cron.ts";
import { stopConfirmationListener } from "./confirmation/subgraph.ts";
import { startWorkflowProcessor } from "./processor.ts";

const concurrency = Number.parseInt(process.env.WORKFLOW_CONCURRENCY ?? "5");

logger.info(`Starting workflow runner (concurrency: ${concurrency})`);

const stopProcessor = await startWorkflowProcessor({ concurrency });
const stopBudgetCron = startBudgetResetCron();

const shutdown = async () => {
	logger.info("Shutting down workflow runner...");
	stopBudgetCron();
	await stopConfirmationListener();
	await stopProcessor();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
