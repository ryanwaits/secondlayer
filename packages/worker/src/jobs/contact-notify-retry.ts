/**
 * Every 10 minutes, email the operator about contact requests that were
 * stored but never notified (send failed, or no notify address at the time).
 * Rows older than a week are left alone: past that the lead is cold and a
 * misconfigured address should not mail a pile of old messages. No-op
 * outside platform mode.
 */

import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { notifyContact } from "@secondlayer/shared/email";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { scheduleCron } from "./cron-schedule.ts";

const INTERVAL_MS = 10 * 60 * 1000;
/** A row this fresh may still be mid-notify in the request that stored it. */
const SETTLE_MS = 2 * 60 * 1000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH = 20;

/** Notifies unnotified contact requests; returns how many went out. */
export async function retryUnnotifiedContacts(
	now = new Date(),
	notify = notifyContact,
): Promise<number> {
	const db = getDb();
	const rows = await db
		.selectFrom("contact_requests")
		.select([
			"id",
			"name",
			"email",
			"company",
			"volume",
			"message",
			"source_page",
		])
		.where("notified_at", "is", null)
		.where("created_at", "<", new Date(now.getTime() - SETTLE_MS))
		.where("created_at", ">", new Date(now.getTime() - MAX_AGE_MS))
		.orderBy("created_at", "asc")
		.limit(BATCH)
		.execute();
	let sent = 0;
	for (const { id, ...row } of rows) {
		if (!(await notify(id, row))) continue;
		await db
			.updateTable("contact_requests")
			.set({ notified_at: now })
			.where("id", "=", id)
			.where("notified_at", "is", null)
			.execute();
		sent++;
	}
	return sent;
}

export function startContactNotifyRetryCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Contact notify retry cron skipped (not platform mode)");
		return () => {};
	}

	const tick = async () => {
		try {
			const sent = await retryUnnotifiedContacts();
			if (sent > 0) logger.info("Retried contact notifications", { sent });
		} catch (err) {
			logger.error("Contact notify retry cron error", {
				error: getErrorMessage(err),
			});
		}
	};

	return scheduleCron(tick, 5 * 60_000, INTERVAL_MS);
}
