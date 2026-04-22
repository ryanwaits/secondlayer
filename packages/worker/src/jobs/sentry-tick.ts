/**
 * Sentry tick cron.
 *
 * Every 60s (platform mode only):
 *   1. Load active sentries from platform DB
 *   2. For each (bounded concurrency 5, skipping in-flight), run detect +
 *      triage + deliver via @secondlayer/sentries runSentryOnce
 *   3. Update last_check_at per-sentry so next tick picks up where we left
 *      off
 *
 * In-memory `inFlight` guard prevents a slow AI triage from causing
 * concurrent runs of the same sentry when the next tick fires.
 */

import { runSentryOnce } from "@secondlayer/sentries";
import { getErrorMessage, logger } from "@secondlayer/shared";
import { getSourceDb, getTargetDb } from "@secondlayer/shared/db";
import { listActiveSentries } from "@secondlayer/shared/db/queries/sentries";
import { getInstanceMode } from "@secondlayer/shared/mode";

const INTERVAL_MS = 60_000;
const INITIAL_DELAY_MS = 5_000;
const CONCURRENCY = 5;

const inFlight = new Set<string>();

export function startSentryTickCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Sentry tick skipped (not platform mode)");
		return () => {};
	}

	const tick = async () => {
		const start = Date.now();
		try {
			await runTick();
		} catch (err) {
			logger.error("sentry-tick error", { error: getErrorMessage(err) });
		}
		logger.debug?.("sentry-tick done", { ms: Date.now() - start });
	};

	const initial = setTimeout(tick, INITIAL_DELAY_MS);
	const interval = setInterval(tick, INTERVAL_MS);

	logger.info("Sentry tick cron started", {
		intervalMs: INTERVAL_MS,
		concurrency: CONCURRENCY,
	});

	return () => {
		clearTimeout(initial);
		clearInterval(interval);
	};
}

async function runTick(): Promise<void> {
	const platformDb = getTargetDb();
	const sourceDb = getSourceDb();

	const sentries = await listActiveSentries(platformDb);
	if (sentries.length === 0) return;

	const pending = sentries.filter((s) => !inFlight.has(s.id));
	if (pending.length === 0) return;

	let index = 0;
	let delivered = 0;
	let deduped = 0;
	let errored = 0;

	const runNext = async (): Promise<void> => {
		while (index < pending.length) {
			const sentry = pending[index++];
			if (!sentry) continue;
			inFlight.add(sentry.id);
			try {
				const result = await runSentryOnce(platformDb, sourceDb, sentry.id, {
					logger,
				});
				delivered += result.delivered;
				deduped += result.deduped;
				errored += result.errors.length;
			} catch (err) {
				logger.error("sentry.run.unhandled", {
					sentryId: sentry.id,
					error: getErrorMessage(err),
				});
				errored += 1;
			} finally {
				inFlight.delete(sentry.id);
			}
		}
	};

	const workers = Array.from(
		{ length: Math.min(CONCURRENCY, pending.length) },
		() => runNext(),
	);
	await Promise.allSettled(workers);

	logger.info("sentry-tick processed", {
		total: sentries.length,
		ran: pending.length,
		skippedInFlight: sentries.length - pending.length,
		delivered,
		deduped,
		errored,
	});
}
