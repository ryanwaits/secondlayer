import type {
	AccountSpendCap,
	Database,
	InsertAccountSpendCap,
	UpdateAccountSpendCap,
} from "@secondlayer/shared/db";
import type { Kysely } from "kysely";

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

export type CapMark = "frozen_at" | "alert_sent_at";

/**
 * Claim a cap email before sending it: stamp `mark` only if it is still unset
 * (or older than `staleBefore`, for a monthly mark) AND the cap is still the
 * `cap` the caller measured spend against. Of two runners, one wins; a cap
 * raised or cleared since the caller read it is not claimed, so a stale
 * snapshot can never re-mark a cap the owner just changed.
 */
export async function claimCapMark(
	db: Kysely<Database>,
	accountId: string,
	mark: CapMark,
	opts: { cap: number; now: Date; staleBefore?: Date },
): Promise<boolean> {
	const row = await db
		.updateTable("account_spend_caps")
		.set({ [mark]: opts.now, updated_at: opts.now })
		.where("account_id", "=", accountId)
		.where("monthly_cap_cents", "=", opts.cap)
		.where((eb) =>
			opts.staleBefore
				? eb.or([eb(mark, "is", null), eb(mark, "<", opts.staleBefore)])
				: eb(mark, "is", null),
		)
		.returning("account_id")
		.executeTakeFirst();
	return row !== undefined;
}

/** Undo `claimCapMark` after the send failed, so the next tick retries. Only
 *  restores a mark still holding `claimedAt` (never one a newer claim wrote). */
export async function releaseCapMark(
	db: Kysely<Database>,
	accountId: string,
	mark: CapMark,
	claimedAt: Date,
	previous: Date | null,
): Promise<void> {
	await db
		.updateTable("account_spend_caps")
		.set({ [mark]: previous })
		.where("account_id", "=", accountId)
		.where(mark, "=", claimedAt)
		.execute();
}

export async function clearFreeze(
	db: Kysely<Database>,
	accountId: string,
): Promise<void> {
	await upsertCaps(db, accountId, {
		frozen_at: null,
		alert_sent_at: null,
	});
}
