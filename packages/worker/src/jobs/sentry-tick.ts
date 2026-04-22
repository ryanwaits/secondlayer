/**
 * Sentry tick cron.
 *
 * Every 60s (platform mode only):
 *   1. Load active sentries from platform DB
 *   2. For each, enqueue a new workflow run (`sentry-<kind>`) with the
 *      sentry config + `sinceIso = last_check_at` as input. The workflow
 *      runtime (running in-process in the worker) dequeues and executes.
 *
 * We don't gate for in-flight tick overlap here anymore — the runtime's
 * own step memoization + run-level retry gives us durable-by-default
 * semantics. A second enqueue while the first is still processing just
 * means two runs; each run's `insertAlert` dedupes via the UNIQUE
 * (sentry_id, idempotency_key) constraint on `sentry_alerts`.
 */

import {
	type LargeOutflowInput,
	WORKFLOW_NAME_BY_KIND,
} from "@secondlayer/sentries";
import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { parseJsonb } from "@secondlayer/shared/db/jsonb";
import { listActiveSentries } from "@secondlayer/shared/db/queries/sentries";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { enqueueWorkflowRun } from "@secondlayer/workflow-runner";

const INTERVAL_MS = 60_000;
const INITIAL_DELAY_MS = 5_000;

export function startSentryTickCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Sentry tick skipped (not platform mode)");
		return () => {};
	}

	const tick = async () => {
		try {
			await runTick();
		} catch (err) {
			logger.error("sentry-tick error", { error: getErrorMessage(err) });
		}
	};

	const initial = setTimeout(tick, INITIAL_DELAY_MS);
	const interval = setInterval(tick, INTERVAL_MS);

	logger.info("Sentry tick cron started", { intervalMs: INTERVAL_MS });

	return () => {
		clearTimeout(initial);
		clearInterval(interval);
	};
}

async function runTick(): Promise<void> {
	const db = getDb();
	const sentries = await listActiveSentries(db);
	if (sentries.length === 0) return;

	let enqueued = 0;
	for (const sentry of sentries) {
		const workflowName = WORKFLOW_NAME_BY_KIND[sentry.kind];
		if (!workflowName) {
			logger.warn("sentry.unknown_kind", {
				sentryId: sentry.id,
				kind: sentry.kind,
			});
			continue;
		}

		const config = parseJsonb<Record<string, unknown>>(sentry.config);
		const input: LargeOutflowInput = {
			sentryId: sentry.id,
			principal: String(config.principal ?? ""),
			thresholdMicroStx: String(config.thresholdMicroStx ?? "0"),
			deliveryWebhook: sentry.delivery_webhook,
			sinceIso: sentry.last_check_at?.toISOString() ?? null,
		};

		try {
			await enqueueWorkflowRun(db, {
				workflowName,
				input,
			});
			enqueued += 1;
		} catch (err) {
			logger.error("sentry.enqueue.failed", {
				sentryId: sentry.id,
				error: getErrorMessage(err),
			});
		}
	}

	logger.info("sentry-tick enqueued", {
		total: sentries.length,
		enqueued,
	});
}
