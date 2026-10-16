import { getTargetDb } from "@secondlayer/shared/db";
import { evaluateTenantInsights } from "@secondlayer/shared/insights";
import {
	INSIGHTS_EVALUATOR_LOCK_KEY,
	type LeaderBackend,
	createPostgresLeaderBackend,
	withLeaderLock,
} from "@secondlayer/shared/leader";
import { logger } from "@secondlayer/shared/logger";
import { targetListenerUrl } from "@secondlayer/shared/queue/listener";

const DEFAULT_INTERVAL_MS = 60_000;

export type StartInsightsLoopOptions = {
	/** Injectable for tests; defaults to the Postgres backend on target. */
	createBackend?: () => LeaderBackend;
	intervalMs?: number;
	/** Injectable for tests; defaults to one tenant evaluation pass. */
	evaluate?: () => Promise<void>;
};

/**
 * Dashboard insights for this stack: webhook and subgraph rules, evaluated
 * every minute on the elected leader only. No customer code runs here. An
 * evaluation error is logged and never reaches the timer.
 */
export function startInsightsLoop(
	opts: StartInsightsLoopOptions = {},
): () => Promise<void> {
	const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
	const evaluate =
		opts.evaluate ?? (() => evaluateTenantInsights(getTargetDb()));

	return withLeaderLock(
		INSIGHTS_EVALUATOR_LOCK_KEY,
		() => {
			let inFlight: Promise<void> | null = null;

			const tick = () => {
				// Never overlap passes: a slow pass skips the next tick.
				if (inFlight) return;
				inFlight = evaluate()
					.catch((err) => {
						logger.warn("insights.evaluate_failed", { error: String(err) });
					})
					.finally(() => {
						inFlight = null;
					});
			};

			tick();
			const timer = setInterval(tick, intervalMs);
			return async () => {
				clearInterval(timer);
				await inFlight;
			};
		},
		{
			createBackend:
				opts.createBackend ??
				(() => createPostgresLeaderBackend(targetListenerUrl())),
		},
	);
}
