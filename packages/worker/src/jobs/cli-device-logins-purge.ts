/**
 * Hourly purge of `cli_device_logins` rows that expired over a day ago. An
 * attempt lives 15 minutes; the day of slack keeps a just-finished sign-in
 * readable while debugging. No-op outside platform mode.
 */

import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { getInstanceMode } from "@secondlayer/shared/mode";

const INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

/** Deletes attempts that expired more than a day before `now`; returns the count. */
export async function purgeExpiredCliDeviceLogins(
	now = new Date(),
): Promise<number> {
	const res = await getDb()
		.deleteFrom("cli_device_logins")
		.where("expires_at", "<", new Date(now.getTime() - RETENTION_MS))
		.executeTakeFirst();
	return Number(res.numDeletedRows);
}

export function startCliDeviceLoginsPurgeCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("CLI sign-in purge cron skipped (not platform mode)");
		return () => {};
	}

	const tick = async () => {
		try {
			const deleted = await purgeExpiredCliDeviceLogins();
			if (deleted > 0) {
				logger.info("Purged expired CLI sign-in attempts", { deleted });
			}
		} catch (err) {
			logger.error("CLI sign-in purge cron error", {
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
