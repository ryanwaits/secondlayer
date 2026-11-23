export type MeterUnit =
	| "archive.partition"
	| "archive.partition.events"
	| "rows.delivered"
	| "memory.gb_hour"
	| "storage.gb_day"
	| "webhook.event"
	| "subgraph.read"
	| "sentinel.run"
	| "sentinel.deep_audit"
	| "sentinel.check_run"
	| "sentinel.monitored_event";

/** Units that still price existing ledger rows but take no new charges: every
 *  `sentinel.*` unit. Sentinel no longer runs audits, and it bills on its own
 *  Stripe subscriptions rather than this ledger. `/internal/meters` refuses them. */
export const RETIRED_METER_UNITS: ReadonlySet<MeterUnit> = new Set([
	"sentinel.run",
	"sentinel.deep_audit",
	"sentinel.check_run",
	"sentinel.monitored_event",
]);

export const PRICES: Record<MeterUnit, bigint> = {
	"archive.partition": 50_000n,
	"archive.partition.events": 150_000n,

	"rows.delivered": 5n,

	"memory.gb_hour": 28_000n,
	"storage.gb_day": 8_333n,
	"webhook.event": 10n,
	"subgraph.read": 10n,

	"sentinel.run": 1_500_000n,
	"sentinel.deep_audit": 3_000_000n,
	"sentinel.check_run": 250_000n,
	"sentinel.monitored_event": 15n,
};

export const HOURS_PER_MONTH = 730;

/** Monthly minimum for a running hosted stack, in USD-micros (founder
 *  2026-10-15). Set in dollars: a webhook-only stack runs no
 *  `subgraph-processor`, so it costs half. The workload host bills it as a
 *  memory floor (`stackMemoryFloorGb`), so a rate change moves the GB floor,
 *  never the dollar floor. */
export const STACK_FLOOR_USD_MICROS_PER_MONTH = {
	webhooks: 5_000_000n,
	subgraphs: 10_000_000n,
} as const;

export function stackMemoryFloorGb(hasSubgraphs: boolean): number {
	const floor =
		STACK_FLOOR_USD_MICROS_PER_MONTH[hasSubgraphs ? "subgraphs" : "webhooks"];
	return Number(floor) / (HOURS_PER_MONTH * Number(PRICES["memory.gb_hour"]));
}

export const CREDIT_USD_MICROS_PER_ROW: bigint = PRICES["rows.delivered"];

export const CREDIT_USD_MICROS_PER_ROW_VOLUME = 2n;

export const COMMIT_TIER_MONTHLY_USD_MICROS = 50_000_000n;

export const MONTHLY_ALLOWANCE: Partial<Record<MeterUnit, number>> = {
	"rows.delivered": 1_000_000,
	"subgraph.read": 100_000,
};

export const ROWS_DELIVERED_MONTHLY_ALLOWANCE = MONTHLY_ALLOWANCE[
	"rows.delivered"
] as number;

/** A hosted subgraph table stream (`handleTableStream`) polls every
 *  SUBGRAPH_STREAM_POLL_MS and sends at most SUBGRAPH_STREAM_BATCH_ROWS rows
 *  per poll. Each poll that delivers rows is one `subgraph.read`; the
 *  workload gateway infers polls from row timing. */
export const SUBGRAPH_STREAM_POLL_MS = 1500;
export const SUBGRAPH_STREAM_BATCH_ROWS = 500;

/** Rows a ghost account (a signed-out reader's docs key) reads in its whole
 *  life, not per month (founder 2026-11-07). Past it the read is refused with
 *  a pointer to signing up. */
export const GHOST_ACCOUNT_ROWS_LIMIT = 100_000;

export const MIN_CREDITED_USD_MICROS = 5_000n;

export const MAX_METER_BATCH = 500;

export const USD_MICROS_PER_CENT = 10_000n;

export function isOverMonthlyCreditCap(
	spentUsdMicros: bigint,
	monthlyCapCents: number | null,
): boolean {
	if (monthlyCapCents == null) return false;
	return spentUsdMicros >= BigInt(monthlyCapCents) * USD_MICROS_PER_CENT;
}

export function nextMonthResetLabel(now: Date = new Date()): string {
	const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
	return at.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}
