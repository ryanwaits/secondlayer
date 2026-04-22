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
	type ContractDeploymentInput,
	type FtOutflowInput,
	type LargeOutflowInput,
	type PermissionChangeInput,
	type PrintEventMatchInput,
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
		const input = buildInput(sentry.kind, {
			sentryId: sentry.id,
			config,
			deliveryWebhook: sentry.delivery_webhook,
			sinceIso: sentry.last_check_at?.toISOString() ?? null,
		});
		if (!input) {
			logger.warn("sentry.bad_config", {
				sentryId: sentry.id,
				kind: sentry.kind,
			});
			continue;
		}

		try {
			await enqueueWorkflowRun(db, {
				workflowName,
				input,
				accountId: sentry.account_id,
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

type SentryInput =
	| LargeOutflowInput
	| PermissionChangeInput
	| FtOutflowInput
	| ContractDeploymentInput
	| PrintEventMatchInput;

function buildInput(
	kind: string,
	common: {
		sentryId: string;
		config: Record<string, unknown>;
		deliveryWebhook: string;
		sinceIso: string | null;
	},
): SentryInput | null {
	const principal = String(common.config.principal ?? "");
	if (!principal) return null;

	if (kind === "large-outflow") {
		return {
			sentryId: common.sentryId,
			principal,
			thresholdMicroStx: String(common.config.thresholdMicroStx ?? "0"),
			deliveryWebhook: common.deliveryWebhook,
			sinceIso: common.sinceIso,
		};
	}

	if (kind === "permission-change") {
		const fns = Array.isArray(common.config.adminFunctions)
			? (common.config.adminFunctions as unknown[]).map(String).filter(Boolean)
			: [];
		if (fns.length === 0) return null;
		return {
			sentryId: common.sentryId,
			principal,
			adminFunctions: fns,
			deliveryWebhook: common.deliveryWebhook,
			sinceIso: common.sinceIso,
		};
	}

	if (kind === "ft-outflow") {
		const assetIdentifier = String(common.config.assetIdentifier ?? "");
		const thresholdAmount = String(common.config.thresholdAmount ?? "0");
		if (!assetIdentifier) return null;
		return {
			sentryId: common.sentryId,
			principal,
			assetIdentifier,
			thresholdAmount,
			deliveryWebhook: common.deliveryWebhook,
			sinceIso: common.sinceIso,
		};
	}

	if (kind === "contract-deployment") {
		return {
			sentryId: common.sentryId,
			principal,
			deliveryWebhook: common.deliveryWebhook,
			sinceIso: common.sinceIso,
		};
	}

	if (kind === "print-event-match") {
		const topic = common.config.topic;
		return {
			sentryId: common.sentryId,
			principal,
			topic: typeof topic === "string" && topic.length > 0 ? topic : null,
			deliveryWebhook: common.deliveryWebhook,
			sinceIso: common.sinceIso,
		};
	}

	return null;
}
