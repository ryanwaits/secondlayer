import {
	ARCHIVE_EVENTS_PARTITION_USD,
	ARCHIVE_PARTITION_USD,
	MEMORY_USD_PER_GB_HOUR,
	ROW_USD_PER_M,
	SENTINEL_AUDIT_USD,
	SENTINEL_CHECK_USD,
	SENTINEL_MONITORED_EVENT_USD_PER_M,
	SENTINEL_RUN_USD,
	STORAGE_USD_PER_GB_MONTH,
	SUBGRAPH_READ_USD_PER_M,
	WEBHOOK_USD_PER_M,
	usd,
} from "./prices";

export type UsageRow = {
	unit: string;
	quantity: string;
	usdMicros: string;
	unpaidUsdMicros?: string;
};

/** Mirrors `ROWS_DELIVERED_MONTHLY_ALLOWANCE` in
 *  `packages/platform/src/billing/prices.ts`. */
export const ROWS_ALLOWANCE = 1_000_000;

const UNIT_LABEL: Record<string, [string, string]> = {
	"rows.delivered": ["Rows delivered", "Index and Streams, live and history"],
	"archive.partition": ["Archive partitions", "Blocks and transactions"],
	"archive.partition.events": ["Archive event partitions", "Events"],
	"webhook.event": ["Webhook events", "Hosted webhooks, retries free"],
	"subgraph.read": [
		"Subgraph reads",
		"Reads of your tables. First 100,000 free each month",
	],
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

export type UsageByMonth = Record<string, UsageRow[]>;

/** Out-of-order responses (a slow fetch for a month the person already
 *  navigated away from) still only ever write their own key, so they can't
 *  clobber whatever month is on screen now. */
export function withUsageMonth(
	prev: UsageByMonth,
	month: string,
	rows: UsageRow[],
): UsageByMonth {
	return { ...prev, [month]: rows };
}

export function formatRows(n: number | string): string {
	const num = Number(n);
	if (num < 1_000_000) return num.toLocaleString("en-US");
	const millions = (num / 1_000_000).toFixed(2);
	return `${millions.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}M`;
}

export function formatUnitQuantity(unit: string, quantity: string): string {
	if (unit === "rows.delivered") return formatRows(quantity);
	if (unit === "memory.gb_hour") return `${Number(quantity).toFixed(1)} GB-h`;
	if (unit === "storage.gb_day") return `${Number(quantity).toFixed(1)} GB-d`;
	return Number(quantity).toLocaleString("en-US");
}

export function deliveredRowsIn(usage: UsageRow[]): number {
	const rd = usage.find((u) => u.unit === "rows.delivered");
	return rd ? Number(rd.quantity) : 0;
}

export type ServiceState = "running" | "stopped" | "none";
export type StackState =
	| "none"
	| "provisioning"
	| "running"
	| "stopped_credits"
	| "stopped_cap"
	| "stopped_idle";
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
	stack?: StackState;
	lastChargedAt: string | null;
	memory24h: MemoryHourRow[];
};

export type UsageResponse = {
	month: string;
	usage: UsageRow[];
	daily: DailySpend[];
	burn: Burn;
	service: HostedStack;
};

export function runwayDays(
	balanceUsdMicros: number,
	rateDayUsdMicros: number,
): number {
	if (rateDayUsdMicros <= 0) return Number.POSITIVE_INFINITY;
	return balanceUsdMicros / rateDayUsdMicros;
}

/** Mirrors `@secondlayer/platform/billing/runway`'s `balanceLevel` exactly
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

/**
 * An unknown burn is not "nothing burning": only a stack stopped for credits
 * or the cap can be called without it.
 */
export function balanceLevelFor(
	billing: { creditsUsdMicros: string } | null,
	burn: Burn | null,
	service: HostedStack | null,
): BalanceLevel | null {
	if (!billing) return null;
	const balance = Number(billing.creditsUsdMicros);
	// A stack stopped for money (credits or the spend cap) is "stopped"; one
	// that is asleep or still starting is not. An API without `stack` only has
	// the legacy state, where stopped at $0 is the same thing.
	const stoppedForMoney = service?.stack
		? service.stack === "stopped_credits" || service.stack === "stopped_cap"
		: service?.state === "stopped" && balance <= 0;
	if (stoppedForMoney) return "stopped";
	if (!burn) return null;
	return balanceLevel({
		serviceState: "none",
		balanceUsdMicros: balance,
		runwayDays: runwayDays(balance, Number(burn.rateDayUsdMicros)),
	});
}

export function daysInUtcMonth(m: Month): number {
	return new Date(Date.UTC(m.year, m.month + 1, 0)).getUTCDate();
}

const MAX_RUNWAY_DAYS = 36_525;

export function runsOutMonth(
	balanceUsdMicros: number,
	rateDayUsdMicros: number,
	now: Date,
): string | null {
	const days = runwayDays(balanceUsdMicros, rateDayUsdMicros);
	// Past a hundred years there is no month worth naming (and a far enough date
	// is not a Date at all).
	if (!Number.isFinite(days) || days > MAX_RUNWAY_DAYS) return null;
	const out = new Date(now.getTime() + days * 86_400_000);
	return out.toLocaleDateString("en-US", {
		timeZone: "UTC",
		month: "short",
		year: "numeric",
	});
}

export function latestMemoryHour(
	memory24h: MemoryHourRow[],
): MemoryHourRow | null {
	return memory24h.length > 0
		? (memory24h[memory24h.length - 1] ?? null)
		: null;
}

export function rateLabel(unit: string, quantity: string): string {
	switch (unit) {
		case "memory.gb_hour":
			return `${usd(MEMORY_USD_PER_GB_HOUR)}/GB-h`;
		case "webhook.event":
			return `${usd(WEBHOOK_USD_PER_M)}/1M`;
		case "subgraph.read":
			return `${usd(SUBGRAPH_READ_USD_PER_M)}/1M`;
		case "storage.gb_day":
			return `${usd(STORAGE_USD_PER_GB_MONTH)}/GB-mo`;
		case "sentinel.check_run":
			return `${usd(SENTINEL_CHECK_USD)}/check`;
		case "sentinel.run":
			return `${usd(SENTINEL_RUN_USD)}/run`;
		case "sentinel.deep_audit":
			return `${usd(SENTINEL_AUDIT_USD)}/audit`;
		case "sentinel.monitored_event":
			return `${usd(SENTINEL_MONITORED_EVENT_USD_PER_M)}/1M`;
		case "archive.partition":
			return `${usd(ARCHIVE_PARTITION_USD)}/partition`;
		case "archive.partition.events":
			return `${usd(ARCHIVE_EVENTS_PARTITION_USD)}/partition`;
		case "rows.delivered":
			return Number(quantity) > ROWS_ALLOWANCE
				? `${usd(ROW_USD_PER_M)}/1M`
				: "free";
		default:
			return "";
	}
}

export type Month = { year: number; month: number };

export function currentUtcMonth(now: Date = new Date()): Month {
	return { year: now.getUTCFullYear(), month: now.getUTCMonth() };
}

export function addMonths(m: Month, delta: number): Month {
	const total = m.year * 12 + m.month + delta;
	return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

export function monthParam(m: Month): string {
	return `${m.year}-${String(m.month + 1).padStart(2, "0")}`;
}

export function monthLabel(m: Month): string {
	return new Date(Date.UTC(m.year, m.month, 1)).toLocaleDateString("en-US", {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});
}

export function monthShortLabel(m: Month): string {
	return new Date(Date.UTC(m.year, m.month, 1)).toLocaleDateString("en-US", {
		month: "short",
		timeZone: "UTC",
	});
}

export function monthName(m: Month): string {
	return new Date(Date.UTC(m.year, m.month, 1)).toLocaleDateString("en-US", {
		month: "long",
		timeZone: "UTC",
	});
}

export function nextMonthLabel(m: Month): string {
	const next = addMonths(m, 1);
	return new Date(Date.UTC(next.year, next.month, 1)).toLocaleDateString(
		"en-US",
		{ month: "short", day: "numeric", timeZone: "UTC" },
	);
}
