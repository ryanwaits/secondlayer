/**
 * Pure helpers for the account billing screens — number and copy
 * formatting, month math, burn and runway. No React, no
 * fetch, so `bun test` covers it without a DOM or a store.
 */

/** One row of `GET /api/billing/usage`'s `usage` array. Quantities and
 *  costs are strings (bigint sums) — see `packages/api/src/routes/billing.ts`. */
export type UsageRow = {
	unit: string;
	quantity: string;
	usdMicros: string;
	/** Sum of this unit's `debited: false` charges this month — attempted
	 *  while the balance was short, never actually taken. `"0"` (or
	 *  absent, for rows shaped before this field existed) when nothing
	 *  went unpaid. */
	unpaidUsdMicros?: string;
};

/** First N `rows.delivered` per account per UTC calendar month are free.
 *  Mirrors `ROWS_DELIVERED_MONTHLY_ALLOWANCE` in
 *  `packages/platform/src/billing/prices.ts` — the one place this number is
 *  read from in the web app. */
export const ROWS_ALLOWANCE = 1_000_000;

/** Label + sub-line for a usage-table row, by unit. Units missing here (a
 *  future meter, or `topup` which has its own row shape) fall back to their
 *  raw name with no sub-line. */
const UNIT_LABEL: Record<string, [string, string]> = {
	"rows.delivered": ["Rows delivered", "Index and Streams, live and history"],
	"archive.partition": ["Archive partitions", "Blocks and transactions"],
	"archive.partition.events": ["Archive event partitions", "Events"],
	"webhook.event": ["Webhook events", "Hosted webhooks, retries free"],
	"memory.gb_hour": ["Hosted stack memory", "Webhooks and subgraphs"],
	"storage.gb_day": ["Hosted stack storage", "Webhooks and subgraphs"],
	"sentinel.check_run": ["Sentinel checks", "Billed per check"],
	// Retired: Sentinel no longer runs audits. Kept so older ledger rows render.
	"sentinel.run": ["Sentinel runs", "Billed per run"],
	"sentinel.deep_audit": ["Sentinel deep audits", "Billed per audit"],
	"sentinel.monitored_event": ["Sentinel monitored events", "Chain events"],
};

export function unitLabel(unit: string): [string, string] {
	return UNIT_LABEL[unit] ?? [unit, ""];
}

/** Usage rows keyed by `YYYY-MM`, one entry per month the store has fetched. */
export type UsageByMonth = Record<string, UsageRow[]>;

/** Merge one month's freshly fetched rows into the keyed store, leaving
 *  every other month's entry untouched. Out-of-order responses (a slow
 *  fetch for a month the person already navigated away from) still only
 *  ever write their own key, so they can't clobber whatever month is on
 *  screen now. */
export function withUsageMonth(
	prev: UsageByMonth,
	month: string,
	rows: UsageRow[],
): UsageByMonth {
	return { ...prev, [month]: rows };
}

/** Rows at or above 1M as `6.41M` / `10M` (trailing decimal zeros stripped,
 *  never `10.00M`); below 1M with thousands separators. */
export function formatRows(n: number | string): string {
	const num = Number(n);
	if (num < 1_000_000) return num.toLocaleString("en-US");
	const millions = (num / 1_000_000).toFixed(2);
	return `${millions.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}M`;
}

/** Quantity for a non-`rows.delivered` unit: GB-hour/GB-day units carry
 *  their unit suffix, one decimal, matching the mock ("12.5 GB-h", "1.4
 *  GB-d") — everything else is a whole-count thousands-separated integer. */
export function formatUnitQuantity(unit: string, quantity: string): string {
	if (unit === "rows.delivered") return formatRows(quantity);
	if (unit === "memory.gb_hour") return `${Number(quantity).toFixed(1)} GB-h`;
	if (unit === "storage.gb_day") return `${Number(quantity).toFixed(1)} GB-d`;
	return Number(quantity).toLocaleString("en-US");
}

/** This month's `rows.delivered` from a usage list, or 0 if the unit hasn't
 *  billed anything yet. */
export function deliveredRowsIn(usage: UsageRow[]): number {
	const rd = usage.find((u) => u.unit === "rows.delivered");
	return rd ? Number(rd.quantity) : 0;
}

// ── Burn, runway, level (Definitions) ──────────────────────────────────

export type ServiceState = "running" | "stopped" | "none";
export type BalanceLevel = "ok" | "low" | "crit" | "stopped";

export type DailySpend = { date: string; unit: string; usdMicros: string };
export type Burn = { rateDayUsdMicros: string; windowHours: number };
export type MemoryHourRow = {
	hour: string;
	billedGb: number;
	observedGb: number | null;
};
export type HostedStack = {
	state: ServiceState;
	lastChargedAt: string | null;
	memory24h: MemoryHourRow[];
};

/** `GET /api/billing/usage`'s full shape — `usage` (month totals by unit,
 *  unchanged), plus `daily`, `burn` and `service` (090). */
export type UsageResponse = {
	month: string;
	usage: UsageRow[];
	daily: DailySpend[];
	burn: Burn;
	service: HostedStack;
};

/** `balance / rateDay`, in days. `Infinity` when `rateDay <= 0` — nothing is
 *  burning, so there's no runway to run out of. */
export function runwayDays(
	balanceUsdMicros: number,
	rateDayUsdMicros: number,
): number {
	if (rateDayUsdMicros <= 0) return Number.POSITIVE_INFINITY;
	return balanceUsdMicros / rateDayUsdMicros;
}

/** `stopped` if the hosted stack is stopped and the balance is at or
 *  below $0; else `crit` at ≤2 days of runway, `low` at ≤7, otherwise `ok`.
 *  Mirrors `@secondlayer/platform/billing/runway`'s `balanceLevel` exactly
 *  (the balance-alert cron's copy of the same math) so the page and the
 *  emails never disagree. */
export function balanceLevel(opts: {
	serviceState: ServiceState;
	balanceUsdMicros: number;
	runwayDays: number;
}): BalanceLevel {
	if (opts.serviceState === "stopped" && opts.balanceUsdMicros <= 0) {
		return "stopped";
	}
	if (opts.runwayDays <= 2) return "crit";
	if (opts.runwayDays <= 7) return "low";
	return "ok";
}

/** Days in the UTC month `{year, month}` falls in (`month` 0-indexed). */
export function daysInUtcMonth(m: Month): number {
	return new Date(Date.UTC(m.year, m.month + 1, 0)).getUTCDate();
}

/** "Oct 2027": the UTC month a balance runs out at `rateDayUsdMicros` a day
 *  from `now`, or null when nothing burns. */
export function runsOutMonth(
	balanceUsdMicros: number,
	rateDayUsdMicros: number,
	now: Date,
): string | null {
	const days = runwayDays(balanceUsdMicros, rateDayUsdMicros);
	if (!Number.isFinite(days)) return null;
	const out = new Date(now.getTime() + days * 86_400_000);
	return out.toLocaleDateString("en-US", {
		timeZone: "UTC",
		month: "short",
		year: "numeric",
	});
}

/** The most recent hour in `service.memory24h` (rows are chronological,
 *  oldest → newest from the API), or `null` when the service has no
 *  memory history in the last 24h. */
export function latestMemoryHour(
	memory24h: MemoryHourRow[],
): MemoryHourRow | null {
	return memory24h.length > 0
		? (memory24h[memory24h.length - 1] ?? null)
		: null;
}

/** Rate label for the Usage table's new Rate column. `rows.delivered` is
 *  the only unit whose label depends on the row's own quantity (free vs.
 *  past the monthly allowance); every other unit is a flat rate. */
export function rateLabel(unit: string, quantity: string): string {
	switch (unit) {
		case "memory.gb_hour":
			return "$0.028/GB-h";
		case "webhook.event":
			return "$10/1M";
		case "storage.gb_day":
			return "$0.25/GB-mo";
		case "sentinel.check_run":
			return "$0.25/check";
		case "sentinel.run":
			return "$1.50/run";
		case "sentinel.deep_audit":
			return "$3/audit";
		case "sentinel.monitored_event":
			return "$15/1M";
		case "archive.partition":
			return "$0.05/partition";
		case "archive.partition.events":
			return "$0.15/partition";
		case "rows.delivered":
			return Number(quantity) > ROWS_ALLOWANCE ? "$5/1M" : "free";
		default:
			return "";
	}
}

/** A UTC calendar month, month 0-indexed (matches `Date#getUTCMonth`). */
export type Month = { year: number; month: number };

export function currentUtcMonth(now: Date = new Date()): Month {
	return { year: now.getUTCFullYear(), month: now.getUTCMonth() };
}

export function addMonths(m: Month, delta: number): Month {
	const total = m.year * 12 + m.month + delta;
	return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/** The `?month=YYYY-MM` query param for `GET /api/billing/usage`. */
export function monthParam(m: Month): string {
	return `${m.year}-${String(m.month + 1).padStart(2, "0")}`;
}

/** "September 2026", for the month switcher and the empty/spent copy. */
export function monthLabel(m: Month): string {
	return new Date(Date.UTC(m.year, m.month, 1)).toLocaleDateString("en-US", {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});
}

/** "Sep" — the daily spend chart's axis-label prefix. */
export function monthShortLabel(m: Month): string {
	return new Date(Date.UTC(m.year, m.month, 1)).toLocaleDateString("en-US", {
		month: "short",
		timeZone: "UTC",
	});
}

/** Just the month word, for "Spent in <Month>". */
export function monthName(m: Month): string {
	return new Date(Date.UTC(m.year, m.month, 1)).toLocaleDateString("en-US", {
		month: "long",
		timeZone: "UTC",
	});
}

/** "Oct 1" — the 1st of the month after `m`, for "Resets ...". */
export function nextMonthLabel(m: Month): string {
	const next = addMonths(m, 1);
	return new Date(Date.UTC(next.year, next.month, 1)).toLocaleDateString(
		"en-US",
		{ month: "short", day: "numeric", timeZone: "UTC" },
	);
}
