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

/** Mirrors `PRICES["memory.gb_hour"]` in
 *  `packages/platform/src/billing/prices.ts` (28,000µ$ = $0.028/GB-hour) —
 *  the delivery service card's cost-per-hour stat tile. */
export const MEMORY_RATE_USD_PER_GB_HOUR = 0.028;

/** Mirrors `MEMORY_FLOOR_GB` in `packages/workload/src/meters.ts`. */
export const MEMORY_FLOOR_GB = 0.5;

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
export type DeliveryService = {
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
	service: DeliveryService;
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

/** `stopped` if the delivery service is stopped and the balance is at or
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

/** Now + runway days, date only, UTC, "Mon D" — Definitions' "Runs out".
 *  Floors `runway` to whole days first, then adds that many calendar days
 *  to `now`'s UTC date (not fractional hours to the exact instant) — the
 *  mock's own `addDays` does the same, e.g. a $8.59 balance at $0.35/day is
 *  a 24.54-day runway that reads "Oct 22" (Sep 28 + 24), not 25. Callers
 *  only pass a finite `runway` (a `stopped`/`ok`-with-no-spend level never
 *  reaches this). */
export function runsOutDate(now: Date, runway: number): string {
	const at = new Date(
		Date.UTC(
			now.getUTCFullYear(),
			now.getUTCMonth(),
			now.getUTCDate() + Math.floor(runway),
		),
	);
	return at.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}

/** Days in the UTC month `{year, month}` falls in (`month` 0-indexed). */
export function daysInUtcMonth(m: Month): number {
	return new Date(Date.UTC(m.year, m.month + 1, 0)).getUTCDate();
}

/** Fractional days left in `now`'s UTC month, counted from right now — e.g.
 *  17:05 UTC on the 28th of a 30-day month leaves `30 - 27.71 ≈ 2.29`
 *  days, not a flat integer. */
export function fractionalDaysRemainingInMonth(now: Date): number {
	const total = daysInUtcMonth(currentUtcMonth(now));
	const elapsed =
		now.getUTCDate() -
		1 +
		now.getUTCHours() / 24 +
		now.getUTCMinutes() / 1440 +
		now.getUTCSeconds() / 86400;
	return total - elapsed;
}

/** Month-to-date spend + `rateDay × (remaining days in the UTC month,
 *  fractional)` — Definitions' "Projected month end". */
export function projectedMonthEndUsdMicros(
	spentSoFarUsdMicros: number,
	rateDayUsdMicros: number,
	remainingDaysFractional: number,
): number {
	return spentSoFarUsdMicros + rateDayUsdMicros * remainingDaysFractional;
}

/** `rateDay × days in next month` — Definitions' "Next month at this
 *  rate". */
export function nextMonthAtRateUsdMicros(
	rateDayUsdMicros: number,
	thisMonth: Month,
): number {
	return rateDayUsdMicros * daysInUtcMonth(addMonths(thisMonth, 1));
}

/** A credit pack's runway at the current burn rate: "about N days at this
 *  rate" / "over a year at this rate" / "starts your service again" when
 *  the delivery service is stopped (Design step 8). */
export function packDaysLabel(
	packUsd: number,
	rateDayUsdMicros: number,
	stopped: boolean,
): string {
	if (stopped) return "starts your service again";
	if (rateDayUsdMicros <= 0) return "over a year at this rate";
	const days = Math.floor((packUsd * 1_000_000) / rateDayUsdMicros);
	if (days >= 365) return "over a year at this rate";
	return `about ${days} day${days === 1 ? "" : "s"} at this rate`;
}

/** The "<Month> so far" header's aside: "Updated HH:MM UTC · next memory
 *  charge HH:00" while running, "Updated HH:MM UTC · service stopped"
 *  otherwise (Design step 5.4). */
export function nextChargeLabel(now: Date, serviceState: ServiceState): string {
	const updated = `Updated ${String(now.getUTCHours()).padStart(2, "0")}:${String(
		now.getUTCMinutes(),
	).padStart(2, "0")} UTC`;
	if (serviceState !== "running") return `${updated} · service stopped`;
	const nextHour = (now.getUTCHours() + 1) % 24;
	return `${updated} · next memory charge ${String(nextHour).padStart(2, "0")}:00`;
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

/** One day of the "<Month> so far" stacked bar chart: real, categorized
 *  spend for a past or in-progress day; a single (hatched, uncategorized)
 *  projected total for a future day. */
export type DailyChartDay = {
	day: number; // 1-indexed day of month
	date: string; // "YYYY-MM-DD"
	memUsdMicros: number;
	eventsUsdMicros: number;
	rowsUsdMicros: number;
	projected: boolean;
};

/** Buckets `daily` into one bar per day of `month`, real categorized spend
 *  through today and one hatched `rateDay`-sized bar per remaining day —
 *  the chart never has real per-category data for a day that hasn't
 *  happened yet, only the aggregate burn rate (Design step 5.4). A past
 *  month (not `now`'s month) has no "today" and no projected days: every
 *  day is real. */
export function buildDailyChart(
	daily: DailySpend[],
	month: Month,
	now: Date,
	rateDayUsdMicros: number,
): DailyChartDay[] {
	const totalDays = daysInUtcMonth(month);
	const isCurrentMonth = isSameMonth(month, currentUtcMonth(now));
	const today = isCurrentMonth ? now.getUTCDate() : totalDays;

	const byDate = new Map<string, DailySpend[]>();
	for (const row of daily) {
		const arr = byDate.get(row.date);
		if (arr) arr.push(row);
		else byDate.set(row.date, [row]);
	}

	const sumUnit = (rows: DailySpend[], unit: string): number =>
		rows
			.filter((r) => r.unit === unit)
			.reduce((total, r) => total + Number(r.usdMicros), 0);

	const days: DailyChartDay[] = [];
	for (let day = 1; day <= totalDays; day++) {
		const date = `${month.year}-${String(month.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
		if (isCurrentMonth && day > today) {
			days.push({
				day,
				date,
				memUsdMicros: 0,
				eventsUsdMicros: 0,
				rowsUsdMicros: 0,
				projected: true,
			});
			continue;
		}
		const rows = byDate.get(date) ?? [];
		days.push({
			day,
			date,
			memUsdMicros: sumUnit(rows, "memory.gb_hour"),
			eventsUsdMicros: sumUnit(rows, "webhook.event"),
			rowsUsdMicros: sumUnit(rows, "rows.delivered"),
			projected: false,
		});
	}
	return days;
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
