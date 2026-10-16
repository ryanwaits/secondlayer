import type { Database, WebhookIncidentAlert } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";

/**
 * Debounce state for the webhook-down email
 * (`POST /internal/webhook-incidents`). One row per incident; a partial unique
 * index allows at most one open row per (account, webhook).
 */

export interface DownIncident {
	id: string;
	name: string;
	failingSince: Date;
}

export interface IncidentReport {
	/** Every webhook id the workload host saw for the account this tick. */
	webhookIds: string[];
	/** The subset currently down. */
	down: DownIncident[];
}

/**
 * Applies one full report atomically. Opens an incident for each down webhook
 * that has none (returned as `opened`, the ones to email) and resolves every
 * open incident of the account that is no longer down. A deleted webhook drops
 * out of `down` too, so it closes the same way.
 */
export async function syncIncidents(
	db: Kysely<Database>,
	accountId: string,
	report: IncidentReport,
	now: Date,
): Promise<{ opened: WebhookIncidentAlert[]; resolved: number }> {
	return db.transaction().execute(async (trx) => {
		const opened: WebhookIncidentAlert[] = [];
		for (const item of report.down) {
			const row = await trx
				.insertInto("webhook_incident_alerts")
				.values({
					account_id: accountId,
					webhook_id: item.id,
					webhook_name: item.name,
					failing_since: item.failingSince,
					opened_at: now,
				})
				.onConflict((oc) =>
					oc
						.columns(["account_id", "webhook_id"])
						.where("resolved_at", "is", null)
						.doNothing(),
				)
				.returningAll()
				.executeTakeFirst();
			if (row) opened.push(row);
		}

		const stillDown = report.down.map((d) => d.id);
		let resolve = trx
			.updateTable("webhook_incident_alerts")
			.set({ resolved_at: now })
			.where("account_id", "=", accountId)
			.where("resolved_at", "is", null);
		if (stillDown.length > 0) {
			resolve = resolve.where("webhook_id", "not in", stillDown);
		}
		const result = await resolve.executeTakeFirst();
		return { opened, resolved: Number(result.numUpdatedRows) };
	});
}

/** Send attempts per incident before giving up on a failing email. */
export const MAX_EMAIL_ATTEMPTS = 5;

/** Open incidents of the account that still need their email: not yet sent
 *  and under the attempt limit. */
export async function dueIncidents(
	db: Kysely<Database>,
	accountId: string,
): Promise<WebhookIncidentAlert[]> {
	return db
		.selectFrom("webhook_incident_alerts")
		.selectAll()
		.where("account_id", "=", accountId)
		.where("resolved_at", "is", null)
		.where("emailed_at", "is", null)
		.where("email_attempts", "<", MAX_EMAIL_ATTEMPTS)
		.execute();
}

/** Counts one send attempt on each row; returns the updated rows. */
export async function recordAttempts(
	db: Kysely<Database>,
	ids: string[],
): Promise<WebhookIncidentAlert[]> {
	if (ids.length === 0) return [];
	return db
		.updateTable("webhook_incident_alerts")
		.set((eb) => ({ email_attempts: eb("email_attempts", "+", 1) }))
		.where("id", "in", ids)
		.returningAll()
		.execute();
}

export async function markEmailed(
	db: Kysely<Database>,
	ids: string[],
	now: Date,
): Promise<void> {
	if (ids.length === 0) return;
	await db
		.updateTable("webhook_incident_alerts")
		.set({ emailed_at: now })
		.where("id", "in", ids)
		.execute();
}

/** Drops resolved incidents older than `olderThanDays`. Returns rows deleted. */
export async function purgeResolved(
	db: Kysely<Database>,
	olderThanDays = 90,
	now: Date = new Date(),
): Promise<number> {
	const cutoff = new Date(now.getTime() - olderThanDays * 86_400_000);
	const result = await db
		.deleteFrom("webhook_incident_alerts")
		.where("resolved_at", "<", cutoff)
		.executeTakeFirst();
	return Number(result.numDeletedRows);
}
