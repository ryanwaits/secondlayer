/**
 * Hourly purge of `api_failed_requests` rows older than 24h. The table is
 * short-lived feedback evidence, not a log. No-op outside platform mode.
 */

import { purgeFailedRequests } from "@secondlayer/platform/db/queries/api-failed-requests";
import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { getInstanceMode } from "@secondlayer/shared/mode";

const INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

/** Deletes records older than 24h as of `now`; returns the deleted count. */
export async function purgeExpiredFailedRequests(
	now = new Date(),
): Promise<number> {
	return purgeFailedRequests(getDb(), new Date(now.getTime() - RETENTION_MS));
}

export function startFailedRequestsPurgeCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Failed-requests purge cron skipped (not platform mode)");
		return () => {};
	}

	const tick = async () => {
		try {
			const deleted = await purgeExpiredFailedRequests();
			if (deleted > 0) {
				logger.info("Purged expired failed-request records", { deleted });
			}
		} catch (err) {
			logger.error("Failed-requests purge cron error", {
				error: getErrorMessage(err),
			});
		}
	};

	const initial = setTimeout(tick, 5 * 60_000);
	const interval = setInterval(tick, INTERVAL_MS);

	return () => {
		clearTimeout(initial);
		clearInterval(interval);
	};
}
