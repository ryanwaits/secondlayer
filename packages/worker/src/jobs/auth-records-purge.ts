/**
 * Hourly purge of `sessions` and `magic_links` that expired over 30 days
 * ago. Neither authenticates once expired; the month of slack keeps recent
 * sign-ins readable while debugging. No-op outside platform mode.
 */

import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { scheduleCron } from "./cron-schedule.ts";

const INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Deletes sessions and magic links expired more than 30 days before `now`. */
export async function purgeExpiredAuthRecords(
	now = new Date(),
): Promise<{ sessions: number; magicLinks: number }> {
	const db = getDb();
	const cutoff = new Date(now.getTime() - RETENTION_MS);
	const sessions = await db
		.deleteFrom("sessions")
		.where("expires_at", "<", cutoff)
		.executeTakeFirst();
	const magicLinks = await db
		.deleteFrom("magic_links")
		.where("expires_at", "<", cutoff)
		.executeTakeFirst();
	return {
		sessions: Number(sessions.numDeletedRows),
		magicLinks: Number(magicLinks.numDeletedRows),
	};
}

export function startAuthRecordsPurgeCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Auth records purge cron skipped (not platform mode)");
		return () => {};
	}

	const tick = async () => {
		try {
			const purged = await purgeExpiredAuthRecords();
			if (purged.sessions > 0 || purged.magicLinks > 0) {
				logger.info("Purged expired sessions and magic links", purged);
			}
		} catch (err) {
			logger.error("Auth records purge cron error", {
				error: getErrorMessage(err),
			});
		}
	};

	return scheduleCron(tick, 5 * 60_000, INTERVAL_MS);
}
