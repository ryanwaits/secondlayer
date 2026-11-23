import { purgeRequestLog } from "@secondlayer/platform/db/queries/api-request-log";
import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { scheduleCron } from "./cron-schedule.ts";

const INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export async function purgeExpiredRequestLog(
	now = new Date(),
): Promise<number> {
	return purgeRequestLog(getDb(), new Date(now.getTime() - RETENTION_MS));
}

export function startRequestLogPurgeCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Request-log purge cron skipped (not platform mode)");
		return () => {};
	}

	const tick = async () => {
		try {
			const deleted = await purgeExpiredRequestLog();
			if (deleted > 0) {
				logger.info("Purged expired request-log rows", { deleted });
			}
		} catch (err) {
			logger.error("Request-log purge cron error", {
				error: getErrorMessage(err),
			});
		}
	};

	return scheduleCron(tick, 5 * 60_000, INTERVAL_MS);
}
