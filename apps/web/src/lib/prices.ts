/**
 * Marketing mirror of `packages/platform/src/billing/prices.ts` (USD-micros,
 * bigint). Web cannot depend on the private platform package, so the numbers
 * are copied as plain dollars and `prices.test.ts` fails when they drift.
 * Changing a price = edit both files.
 */

/** Rows delivered: $ per 1M rows (1 µ$ per row = $1 per 1M). */
export const ROW_USD_PER_M = 5;
/** Rows delivered once the month's total spend reaches the volume tier. */
export const ROW_USD_PER_M_VOLUME = 2;
/** Monthly spend (all meters) at which rows drop to the volume rate. */
export const VOLUME_TIER_MONTHLY_USD = 50;
/** First rows each month on every account are free. */
export const FREE_ROWS_PER_MONTH = 1_000_000;

export const MEMORY_USD_PER_GB_HOUR = 0.028;
/** 8_333 µ$ per GB-day x 30 days = 249_990 µ$, billed as "about $0.25". */
export const STORAGE_USD_PER_GB_MONTH = 0.25;
/** Webhook events: $ per 1M delivered. Retries are never billed. */
export const WEBHOOK_USD_PER_M = 10;

export const ARCHIVE_PARTITION_USD = 0.05;
export const ARCHIVE_EVENTS_PARTITION_USD = 0.15;
export const FREE_REPAIR_PARTITIONS_PER_MONTH = 18;

/** Prepaid credit packs, in dollars (`CREDIT_PACKS_USD` in the API). */
export const CREDIT_PACKS_USD = [10, 25, 50, 100] as const;

/** A running stack bills at least this much memory. */
export const STACK_MEMORY_FLOOR_GB = 0.5;
/** Pricing page months are 730 hours. */
export const HOURS_PER_MONTH = 730;

export interface MonthInput {
	/** Rows delivered in the month (free allowance included). */
	rows: number;
	/** Hosted stack running. A stopped or absent stack bills nothing. */
	running: boolean;
	memoryGb: number;
	storageGb: number;
	webhookEvents: number;
}

export interface MonthEstimate {
	billableRows: number;
	/** Billable rows priced at the volume rate. */
	volumeRows: number;
	rowsUsd: number;
	volumeUsd: number;
	memoryUsd: number;
	storageUsd: number;
	webhooksUsd: number;
	totalUsd: number;
}

/**
 * Mirrors `meter.ts`: the tier break is the account's TOTAL month spend, so
 * the non-row meters are summed first. Rows past the free allowance bill at
 * the base rate while that running total is under the tier, and at the volume
 * rate beyond the point it reaches the tier.
 */
export function estimateMonth(input: MonthInput): MonthEstimate {
	const { rows, running, memoryGb, storageGb, webhookEvents } = input;

	const memoryUsd = running
		? Math.max(memoryGb, STACK_MEMORY_FLOOR_GB) *
			HOURS_PER_MONTH *
			MEMORY_USD_PER_GB_HOUR
		: 0;
	const storageUsd = running ? storageGb * STORAGE_USD_PER_GB_MONTH : 0;
	const webhooksUsd = running ? (webhookEvents / 1e6) * WEBHOOK_USD_PER_M : 0;
	const fixedUsd = memoryUsd + storageUsd + webhooksUsd;

	const billableRows = Math.max(0, rows - FREE_ROWS_PER_MONTH);
	const roomUsd = Math.max(0, VOLUME_TIER_MONTHLY_USD - fixedUsd);
	const baseUsd = Math.min((billableRows / 1e6) * ROW_USD_PER_M, roomUsd);
	const volumeRows = Math.max(
		0,
		billableRows - (baseUsd / ROW_USD_PER_M) * 1e6,
	);
	const volumeUsd = (volumeRows / 1e6) * ROW_USD_PER_M_VOLUME;
	const rowsUsd = baseUsd + volumeUsd;

	return {
		billableRows,
		volumeRows,
		rowsUsd,
		volumeUsd,
		memoryUsd,
		storageUsd,
		webhooksUsd,
		totalUsd: fixedUsd + rowsUsd,
	};
}

/**
 * "$5", "$0.05", "$0.028", "$10.22". Whole dollars drop the cents; amounts
 * that are not whole cents (per-unit prices) keep a third decimal.
 */
export function usd(n: number): string {
	if (Number.isInteger(n)) return `$${n}`;
	const cents = n * 100;
	const wholeCents = Math.abs(cents - Math.round(cents)) < 1e-9;
	return `$${n.toFixed(wholeCents ? 2 : 3)}`;
}

/** Statement style: always two decimals, thousands separated. */
export function usdExact(n: number): string {
	return n.toLocaleString("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
}
