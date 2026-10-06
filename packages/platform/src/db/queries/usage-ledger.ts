import type { Database, UsageLedgerRow } from "@secondlayer/shared/db";
import { type Kysely, sql } from "kysely";

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
	/** Raw sampled quantity before any floor (`memory.gb_hour` only; every
	 *  other unit passes `null`). */
	observedQuantity: number | null;
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
			observed_quantity: entry.observedQuantity,
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

/** Ledger units Sentinel owns. Settling and owed sums never look past this. */
export const SENTINEL_UNIT_PREFIX = "sentinel.";

/** Sum of Sentinel usage that was recorded but never paid (`debited=false`).
 *  Only `sentinel.*` rows count; every other unit is invisible here. */
export async function owedSentinelUsdMicros(
	db: Kysely<Database>,
	accountId: string,
): Promise<bigint> {
	const row = await db
		.selectFrom("usage_ledger")
		.select(sql<string>`COALESCE(SUM(usd_micros), 0)`.as("owed"))
		.where("account_id", "=", accountId)
		.where("debited", "=", false)
		.where(sql<boolean>`unit LIKE ${`${SENTINEL_UNIT_PREFIX}%`}`)
		.executeTakeFirstOrThrow();
	return BigInt(row.owed);
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
	/** Sum of `usd_micros` for this unit's `debited: false` rows this month
	 *  — a charge attempted while the balance was short, still on the
	 *  ledger but never actually taken. Additive to `usdMicros` (which sums
	 *  every row regardless of `debited`, unchanged from before) — never
	 *  subtracted, so existing readers of `usdMicros` see the same total
	 *  they always did. "0" when nothing this unit charged went unpaid. */
	unpaidUsdMicros: string;
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
			sql<string>`sum(case when debited = false then usd_micros else 0 end)`.as(
				"unpaid_usd_micros",
			),
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
		unpaidUsdMicros: row.unpaid_usd_micros ?? "0",
	}));
}

export type DailySpend = {
	date: string; // "YYYY-MM-DD", UTC
	unit: string;
	usdMicros: string;
};

/** One row per UTC day × unit for `now`'s calendar month, positive charges
 *  only (a top-up's negative `usd_micros` would otherwise show as a bar
 *  under the axis) — the credits page's stacked daily-spend chart. */
export async function dailySpendForMonth(
	db: Kysely<Database>,
	accountId: string,
	now: Date = new Date(),
): Promise<DailySpend[]> {
	const { start, end } = monthBounds(now);
	const rows = await db
		.selectFrom("usage_ledger")
		.select((eb) => [
			// `AT TIME ZONE 'UTC'` on both sides makes the truncation a UTC day
			// boundary regardless of the session's timezone setting.
			sql<Date>`date_trunc('day', occurred_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`.as(
				"day",
			),
			"unit",
			eb.fn.sum<string>("usd_micros").as("usd_micros"),
		])
		.where("account_id", "=", accountId)
		.where("occurred_at", ">=", start)
		.where("occurred_at", "<", end)
		.where("usd_micros", ">", "0")
		.groupBy(
			sql`date_trunc('day', occurred_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
		)
		.groupBy("unit")
		.orderBy("day")
		.execute();
	return rows.map((row) => ({
		date: new Date(row.day).toISOString().slice(0, 10),
		unit: row.unit,
		usdMicros: row.usd_micros ?? "0",
	}));
}

/** Sum of positive `usd_micros` across every unit in the trailing 24h — the
 *  "burning now" rate. Always relative to `now`, independent of whatever
 *  month the usage table is browsing. */
export async function burnRateUsdMicros(
	db: Kysely<Database>,
	accountId: string,
	now: Date = new Date(),
): Promise<bigint> {
	const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
	const row = await db
		.selectFrom("usage_ledger")
		.select((eb) => eb.fn.sum<string>("usd_micros").as("total"))
		.where("account_id", "=", accountId)
		.where("occurred_at", ">=", since)
		.where("occurred_at", "<=", now)
		.where("usd_micros", ">", "0")
		.executeTakeFirst();
	return row?.total ? BigInt(row.total) : 0n;
}

/** Distinct `account_id`s the balance-alert cron needs to check: anything
 *  with a positive charge in the last 24h (so it has a burn rate to project
 *  from), or a `memory.gb_hour` row in the last 35 days (a hosted stack
 *  that isn't `none` — it could still be `stopped`, which is exactly the
 *  case the "your service stopped" email exists for). */
export async function accountsToCheckForBalanceAlerts(
	db: Kysely<Database>,
	now: Date = new Date(),
): Promise<string[]> {
	const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
	const since35d = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);
	const rows = await db
		.selectFrom("usage_ledger")
		.select("account_id")
		.distinct()
		.where((eb) =>
			eb.or([
				eb.and([eb("usd_micros", ">", "0"), eb("occurred_at", ">=", since24h)]),
				eb.and([
					eb("unit", "=", "memory.gb_hour"),
					eb("occurred_at", ">=", since35d),
				]),
			]),
		)
		.execute();
	return rows.map((r) => r.account_id);
}

export type ServiceState = "running" | "stopped" | "none";

export type MemoryHourRow = {
	hour: string; // ISO
	billedGb: number;
	observedGb: number | null;
};

export type DeliveryServiceSnapshot = {
	state: ServiceState;
	lastChargedAt: string | null;
	memory24h: MemoryHourRow[];
};

const SERVICE_RUNNING_WINDOW_MS = 75 * 60 * 1000;
const SERVICE_STOPPED_WINDOW_MS = 35 * 24 * 60 * 60 * 1000;
const MEMORY_24H_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Derives the hosted-stack state from `memory.gb_hour` ledger rows —
 *  no new plumbing, per Definitions: `running` if a row exists in the last
 *  75 min, `stopped` if one exists in the last 35 days but not the last 75
 *  min, `none` if neither (never ran, or last ran more than 35 days ago). */
export async function deliveryServiceSnapshot(
	db: Kysely<Database>,
	accountId: string,
	now: Date = new Date(),
): Promise<DeliveryServiceSnapshot> {
	const since35d = new Date(now.getTime() - SERVICE_STOPPED_WINDOW_MS);
	const since75m = new Date(now.getTime() - SERVICE_RUNNING_WINDOW_MS);
	const since24h = new Date(now.getTime() - MEMORY_24H_WINDOW_MS);

	const rows = await db
		.selectFrom("usage_ledger")
		.select(["occurred_at", "quantity", "observed_quantity"])
		.where("account_id", "=", accountId)
		.where("unit", "=", "memory.gb_hour")
		.where("occurred_at", ">=", since35d)
		.where("occurred_at", "<=", now)
		.orderBy("occurred_at", "asc")
		.execute();

	const last = rows.at(-1);
	const state: ServiceState = !last
		? "none"
		: last.occurred_at >= since75m
			? "running"
			: "stopped";

	// Bucketed by UTC hour, not one point per row: a retried flush that lands
	// several samples under the same (or a nearby) `occurred_at` must never
	// blow the chart past 24 points — sum whatever landed in each hour
	// instead of trusting the ledger to have exactly one row per hour.
	const buckets = await db
		.selectFrom("usage_ledger")
		.select((eb) => [
			sql<Date>`date_trunc('hour', occurred_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`.as(
				"hour",
			),
			eb.fn.sum<string>("quantity").as("billed_gb"),
			sql<string | null>`sum(observed_quantity)`.as("observed_gb"),
		])
		.where("account_id", "=", accountId)
		.where("unit", "=", "memory.gb_hour")
		.where("occurred_at", ">=", since24h)
		.where("occurred_at", "<=", now)
		.groupBy(
			sql`date_trunc('hour', occurred_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
		)
		.orderBy("hour", "asc")
		.execute();

	return {
		state,
		lastChargedAt: last ? last.occurred_at.toISOString() : null,
		memory24h: buckets.map((b) => ({
			hour: b.hour.toISOString(),
			billedGb: Number(b.billed_gb),
			observedGb: b.observed_gb != null ? Number(b.observed_gb) : null,
		})),
	};
}
