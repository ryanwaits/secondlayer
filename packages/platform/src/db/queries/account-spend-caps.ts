import type {
	AccountSpendCap,
	Database,
	InsertAccountSpendCap,
	UpdateAccountSpendCap,
} from "@secondlayer/shared/db";
import type { Kysely } from "kysely";

/**
 * Spend-cap state for an account. Both the metering crons (check + set
 * frozen_at) and the dashboard (read + update caps) call through here.
 */

export async function getCaps(
	db: Kysely<Database>,
	accountId: string,
): Promise<AccountSpendCap | null> {
	const row = await db
		.selectFrom("account_spend_caps")
		.selectAll()
		.where("account_id", "=", accountId)
		.executeTakeFirst();
	return row ?? null;
}

/**
 * Upsert semantics: row is created on first write (default threshold
 * 80%), subsequent writes PATCH. `updated_at` is always bumped.
 */
export async function upsertCaps(
	db: Kysely<Database>,
	accountId: string,
	patch: Omit<UpdateAccountSpendCap, "account_id" | "updated_at">,
): Promise<AccountSpendCap> {
	const insert: InsertAccountSpendCap = {
		account_id: accountId,
		monthly_cap_cents: patch.monthly_cap_cents ?? null,
		compute_cap_cents: patch.compute_cap_cents ?? null,
		storage_cap_cents: patch.storage_cap_cents ?? null,
		alert_threshold_pct: patch.alert_threshold_pct ?? 80,
		alert_sent_at: patch.alert_sent_at ?? null,
		frozen_at: patch.frozen_at ?? null,
	};

	return db
		.insertInto("account_spend_caps")
		.values(insert)
		.onConflict((oc) =>
			oc.column("account_id").doUpdateSet({
				...patch,
				updated_at: new Date(),
			}),
		)
		.returningAll()
		.executeTakeFirstOrThrow();
}

/**
 * Clear the frozen + alert state — called on `invoice.paid` webhook at
 * cycle rollover (new billing period starts fresh) OR when the user
 * explicitly raises their cap above current usage.
 */
export async function clearFreeze(
	db: Kysely<Database>,
	accountId: string,
): Promise<void> {
	await upsertCaps(db, accountId, {
		frozen_at: null,
		alert_sent_at: null,
	});
}
