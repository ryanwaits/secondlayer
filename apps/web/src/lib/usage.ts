/**
 * Pure helpers for the /account/credits usage view — number and copy
 * formatting, month math, and the free-allowance gate math. No React, no
 * fetch, so `bun test` covers it without a DOM or a store.
 */

/** One row of `GET /api/billing/usage`'s `usage` array. Quantities and
 *  costs are strings (bigint sums) — see `packages/api/src/routes/billing.ts`. */
export type UsageRow = {
	unit: string;
	quantity: string;
	usdMicros: string;
};

/** First N `rows.delivered` per account per UTC calendar month are free.
 *  Mirrors `ROWS_DELIVERED_MONTHLY_ALLOWANCE` in
 *  `packages/platform/src/billing/prices.ts` — the one place this number is
 *  read from in the web app. */
export const ROWS_ALLOWANCE = 10_000_000;

/** Label + sub-line for a usage-table row, by unit. Units missing here (a
 *  future meter, or `topup` which has its own row shape) fall back to their
 *  raw name with no sub-line. */
const UNIT_LABEL: Record<string, [string, string]> = {
	"rows.delivered": ["Rows delivered", "Index and Streams, live and history"],
	"archive.partition": ["Archive partitions", "Blocks and transactions"],
	"archive.partition.events": ["Archive event partitions", "Events"],
	"webhook.event": ["Webhook events", "Hosted webhooks, retries free"],
	"memory.gb_hour": ["Delivery service memory", "Hosted webhooks"],
	"storage.gb_day": ["Delivery service storage", "Hosted webhooks"],
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

/** Quantity for a non-`rows.delivered` unit: GB units keep up to 2 decimals
 *  (fractional GB-hours/GB-days are real), everything else is a whole-count
 *  thousands-separated integer. */
export function formatUnitQuantity(unit: string, quantity: string): string {
	if (unit === "rows.delivered") return formatRows(quantity);
	if (unit === "memory.gb_hour" || unit === "storage.gb_day") {
		return Number(quantity).toLocaleString("en-US", {
			maximumFractionDigits: 2,
		});
	}
	return Number(quantity).toLocaleString("en-US");
}

/** Sum of positive `usdMicros` across a month's usage — `topup` rows carry
 *  negative `usdMicros` and are excluded, matching the "Spent in <Month>"
 *  footer. */
export function spentUsdMicros(usage: UsageRow[]): number {
	return usage.reduce((total, u) => {
		const v = Number(u.usdMicros);
		return v > 0 ? total + v : total;
	}, 0);
}

/** This month's `rows.delivered` from a usage list, or 0 if the unit hasn't
 *  billed anything yet. */
export function deliveredRowsIn(usage: UsageRow[]): number {
	const rd = usage.find((u) => u.unit === "rows.delivered");
	return rd ? Number(rd.quantity) : 0;
}

/** Fraction of the monthly free-rows allowance already used (can exceed 1
 *  once the allowance is spent past). */
export function allowanceUsedFraction(rowsDelivered: number): number {
	return rowsDelivered / ROWS_ALLOWANCE;
}

/** Whole UTC days elapsed so far in `now`'s month — day 1 of the month
 *  counts as 1, never 0, so a same-day spend still projects a rate. */
export function utcDaysElapsedInMonth(now: Date = new Date()): number {
	return now.getUTCDate();
}

/**
 * ≈ days of credit left at this month's daily spend rate, or `null` when
 * there's nothing to project from: no balance, no spend yet, or (degenerate)
 * no days elapsed. "≈0 days" reads as an alarm the numbers don't back up
 * when there's no real spend to extrapolate — `null` lets the caller render
 * nothing instead.
 */
export function runwayDays(
	creditsUsdMicros: number,
	monthSpentUsdMicros: number,
	daysElapsedInMonth: number,
): number | null {
	if (
		creditsUsdMicros <= 0 ||
		monthSpentUsdMicros <= 0 ||
		daysElapsedInMonth <= 0
	) {
		return null;
	}
	const dailyRate = monthSpentUsdMicros / daysElapsedInMonth;
	return Math.floor(creditsUsdMicros / dailyRate);
}

/** The free-rows meter's foot line: under / exactly-at / over the monthly
 *  allowance. `resetLabel` is the pre-formatted date the allowance resets
 *  (e.g. "Oct 1"). */
export function allowanceFootLine(
	rowsDelivered: number,
	resetLabel: string,
): string {
	if (rowsDelivered > ROWS_ALLOWANCE) {
		return `Allowance used. ${formatRows(rowsDelivered - ROWS_ALLOWANCE)} rows past it this month, paid from your balance. Resets ${resetLabel}.`;
	}
	if (rowsDelivered === ROWS_ALLOWANCE) {
		return `Allowance used. Resets ${resetLabel}.`;
	}
	return `${formatRows(ROWS_ALLOWANCE - rowsDelivered)} free rows left. Resets ${resetLabel}.`;
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

export function isSameMonth(a: Month, b: Month): boolean {
	return a.year === b.year && a.month === b.month;
}

/** -1 if `a` is before `b`, 0 if the same month, 1 if after. */
export function compareMonths(a: Month, b: Month): number {
	const av = a.year * 12 + a.month;
	const bv = b.year * 12 + b.month;
	return av === bv ? 0 : av < bv ? -1 : 1;
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

/** The UTC month an ISO `createdAt` falls in, or `null` if unparseable —
 *  bounds how far back the usage month switcher can go. */
export function accountCreationMonth(
	createdAt: string | null | undefined,
): Month | null {
	if (!createdAt) return null;
	const d = new Date(createdAt);
	if (Number.isNaN(d.getTime())) return null;
	return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}
