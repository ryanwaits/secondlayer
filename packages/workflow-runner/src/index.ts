import { logger } from "@secondlayer/shared/logger";
import { startWorkflowProcessor } from "./processor.ts";

const concurrency = Number.parseInt(
	process.env.WORKFLOW_CONCURRENCY ?? "5",
);

logger.info(`Starting workflow runner (concurrency: ${concurrency})`);

const stop = await startWorkflowProcessor({ concurrency });

const shutdown = async () => {
	logger.info("Shutting down workflow runner...");
	await stop();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
