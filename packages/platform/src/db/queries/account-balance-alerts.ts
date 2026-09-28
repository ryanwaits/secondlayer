import type {
	AccountBalanceAlerts,
	Database,
	InsertAccountBalanceAlerts,
	UpdateAccountBalanceAlerts,
} from "@secondlayer/shared/db";
import type { Kysely } from "kysely";

/**
 * Preferences + debounce state for the balance-runway email alerts
 * (`packages/worker/src/jobs/balance-alert.ts`). Both the cron (read +
 * debounce-mark) and `GET/PUT /api/billing/alerts` (read + preference write)
 * call through here.
 */

export async function getBalanceAlerts(
	db: Kysely<Database>,
	accountId: string,
): Promise<AccountBalanceAlerts | null> {
	const row = await db
		.selectFrom("account_balance_alerts")
		.selectAll()
		.where("account_id", "=", accountId)
		.executeTakeFirst();
	return row ?? null;
}

/** Upsert semantics: row is created on first write (both notifications on
 *  by default), subsequent writes PATCH. */
export async function upsertBalanceAlerts(
	db: Kysely<Database>,
	accountId: string,
	patch: Omit<UpdateAccountBalanceAlerts, "account_id">,
): Promise<AccountBalanceAlerts> {
	const insert: InsertAccountBalanceAlerts = {
		account_id: accountId,
		notify_7d: patch.notify_7d ?? true,
		notify_2d: patch.notify_2d ?? true,
		sent_7d_at: patch.sent_7d_at ?? null,
		sent_2d_at: patch.sent_2d_at ?? null,
		sent_stopped_at: patch.sent_stopped_at ?? null,
	};
	return db
		.insertInto("account_balance_alerts")
		.values(insert)
		.onConflict((oc) => oc.column("account_id").doUpdateSet(patch))
		.returningAll()
		.executeTakeFirstOrThrow();
}

/** Re-arm: clear every debounce mark, so a top-up that pushes runway back
 *  over 7 days lets the next crossing alert again. */
export async function clearSentBalanceAlerts(
	db: Kysely<Database>,
	accountId: string,
): Promise<void> {
	await upsertBalanceAlerts(db, accountId, {
		sent_7d_at: null,
		sent_2d_at: null,
		sent_stopped_at: null,
	});
}
