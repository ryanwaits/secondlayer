/**
 * Daily purge of resolved `webhook_incident_alerts` rows older than 90 days.
 * Open incidents are never touched. No-op outside platform mode: the outage
 * table is only written by the platform's `/internal/webhook-incidents`.
 */

import { purgeResolved } from "@secondlayer/platform/db/queries/webhook-incident-alerts";
import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { scheduleCron } from "./cron-schedule.ts";

const INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startWebhookIncidentsPurgeCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Webhook incident purge cron skipped (not platform mode)");
		return () => {};
	}

	const tick = async () => {
		try {
			const deleted = await purgeResolved(getDb());
			if (deleted > 0) {
				logger.info("Purged resolved webhook incidents", { deleted });
			}
		} catch (err) {
			logger.error("Webhook incident purge cron error", {
				error: getErrorMessage(err),
			});
		}
	};

	return scheduleCron(tick, 5 * 60_000, INTERVAL_MS);
}
