import type { Database, UsageLedgerRow } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";

/**
 * The metered ledger: one append-only row per billable (or free
 * -allowance) unit. Written only by `meter()` (`../billing/meter.ts`); this
 * module is the plain DB access underneath it, mirroring `account-credits.ts`
 * and `archive-fetches.ts` — functions over an injected `Kysely<Database>`
 * (or `Transaction<Database>`) so `meter()` can run inside a caller's own
 * transaction (the archive fetch gate's aggregate charge, for one).
 */

export type LedgerEntry = {
	accountId: string;
	unit: string;
	quantity: number;
	usdMicros: bigint;
	debited: boolean;
	source: string;
	idempotencyKey: string;
	occurredAt: Date;
};

/**
 * Atomically claim an idempotency key: insert the row, or — if a prior call
 * already wrote it — return that row untouched with `claimed: false`. The
 * unique constraint on `idempotency_key` makes the claim race-safe, so a
 * caller only debits a balance when `claimed` is true; a replay (concurrent
 * or retried) always sees `claimed: false` and must not charge again.
 */
export async function claimLedgerEntry(
	db: Kysely<Database>,
	entry: LedgerEntry,
): Promise<{ row: UsageLedgerRow; claimed: boolean }> {
	const inserted = await db
		.insertInto("usage_ledger")
		.values({
			account_id: entry.accountId,
			unit: entry.unit,
			quantity: entry.quantity,
			usd_micros: entry.usdMicros.toString(),
			debited: entry.debited,
			source: entry.source,
			idempotency_key: entry.idempotencyKey,
			occurred_at: entry.occurredAt,
		})
		.onConflict((oc) => oc.column("idempotency_key").doNothing())
		.returningAll()
		.executeTakeFirst();
	if (inserted) return { row: inserted, claimed: true };
	const existing = await db
		.selectFrom("usage_ledger")
		.selectAll()
		.where("idempotency_key", "=", entry.idempotencyKey)
		.executeTakeFirstOrThrow();
	return { row: existing, claimed: false };
}

/** Flip a claimed row's `debited` flag after the debit attempt resolves —
 *  the row is inserted optimistic (`debited: true`) before the debit runs
 *  so the idempotency claim and the charge share one statement each. */
export async function markLedgerEntryDebited(
	db: Kysely<Database>,
	id: string,
	debited: boolean,
): Promise<void> {
	await db
		.updateTable("usage_ledger")
		.set({ debited })
		.where("id", "=", id)
		.execute();
}

/** UTC calendar-month bounds `now` falls in: `[start, end)`. */
export function monthBounds(now: Date): { start: Date; end: Date } {
	const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	const end = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
	);
	return { start, end };
}

/** Sum of `quantity` for `unit` this account has recorded in `now`'s UTC
 *  calendar month — the allowance counter for `rows.delivered`. */
export async function monthlyQuantity(
	db: Kysely<Database>,
	accountId: string,
	unit: string,
	now: Date = new Date(),
): Promise<number> {
	const { start, end } = monthBounds(now);
	const row = await db
		.selectFrom("usage_ledger")
		.select((eb) => eb.fn.sum<string>("quantity").as("total"))
		.where("account_id", "=", accountId)
		.where("unit", "=", unit)
		.where("occurred_at", ">=", start)
		.where("occurred_at", "<", end)
		.executeTakeFirst();
	return row?.total ? Number(row.total) : 0;
}

export type UsageByUnit = {
	unit: string;
	quantity: string;
	usdMicros: string;
};

/** Per-unit quantity + cost for `now`'s UTC calendar month — the account
 *  usage view (`GET /api/billing/usage`). */
export async function usageForMonth(
	db: Kysely<Database>,
	accountId: string,
	now: Date = new Date(),
): Promise<UsageByUnit[]> {
	const { start, end } = monthBounds(now);
	const rows = await db
		.selectFrom("usage_ledger")
		.select((eb) => [
			"unit",
			eb.fn.sum<string>("quantity").as("quantity"),
			eb.fn.sum<string>("usd_micros").as("usd_micros"),
		])
		.where("account_id", "=", accountId)
		.where("occurred_at", ">=", start)
		.where("occurred_at", "<", end)
		.groupBy("unit")
		.orderBy("unit")
		.execute();
	return rows.map((row) => ({
		unit: row.unit,
		quantity: row.quantity ?? "0",
		usdMicros: row.usd_micros ?? "0",
	}));
}
