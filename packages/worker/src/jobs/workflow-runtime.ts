/**
 * Workflow runtime loop (platform mode).
 *
 * Boots the workflow-runner inside this worker process with a registry
 * containing every sentry kind. Runs alongside the other cron jobs; no
 * separate service.
 */

import { buildSentryRegistry } from "@secondlayer/sentries";
import { logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { startWorkflowProcessor } from "@secondlayer/workflow-runner";

const CONCURRENCY = Number.parseInt(process.env.WORKFLOW_CONCURRENCY ?? "5");

export function startWorkflowRuntime(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Workflow runtime skipped (not platform mode)");
		return () => {};
	}

	const registry = buildSentryRegistry();
	const stop = startWorkflowProcessor({
		db: getDb(),
		registry,
		concurrency: CONCURRENCY,
	});

	return stop;
}
