/**
 * Marketing mirror of `packages/platform/src/billing/prices.ts` (USD-micros,
 * bigint). Web cannot depend on the private platform package, so the numbers
 * are copied as plain dollars and `prices.test.ts` fails when they drift.
 * Changing a price = edit both files.
 */

export const ROW_USD_PER_M = 5;
export const ROW_USD_PER_M_VOLUME = 2;
export const VOLUME_TIER_MONTHLY_USD = 50;
export const FREE_ROWS_PER_MONTH = 1_000_000;

export const MEMORY_USD_PER_GB_HOUR = 0.028;
export const STORAGE_USD_PER_GB_MONTH = 0.25;
export const WEBHOOK_USD_PER_M = 10;
export const SUBGRAPH_READ_USD_PER_M = 10;
export const FREE_SUBGRAPH_READS_PER_MONTH = 100_000;

export const SENTINEL_CHECK_USD = 0.25;
export const SENTINEL_RUN_USD = 1.5;
export const SENTINEL_AUDIT_USD = 3;
export const SENTINEL_MONITORED_EVENT_USD_PER_M = 15;

export const ARCHIVE_PARTITION_USD = 0.05;
export const ARCHIVE_EVENTS_PARTITION_USD = 0.15;
export const FREE_REPAIR_PARTITIONS_PER_MONTH = 24;

export const CREDIT_PACKS_USD = [10, 25, 50, 100] as const;

export const TOPUP_MIN_USD = 5;
export const TOPUP_MAX_USD = 1000;

export const HOURS_PER_MONTH = 730;

export const STACK_FLOOR_USD_PER_MONTH = {
	webhooks: 5,
	subgraphs: 10,
} as const;

export function stackMemoryFloorGb(hasSubgraphs: boolean): number {
	const floor =
		STACK_FLOOR_USD_PER_MONTH[hasSubgraphs ? "subgraphs" : "webhooks"];
	return floor / (HOURS_PER_MONTH * MEMORY_USD_PER_GB_HOUR);
}

export interface MonthInput {
	rows: number;
	running: boolean;
	hasSubgraphs: boolean;
	memoryGb: number;
	storageGb: number;
	webhookEvents: number;
	subgraphReads: number;
}

export interface MonthEstimate {
	billableRows: number;
	volumeRows: number;
	rowsUsd: number;
	volumeUsd: number;
	memoryUsd: number;
	storageUsd: number;
	webhooksUsd: number;
	readsUsd: number;
	totalUsd: number;
}

/**
 * Mirrors `meter.ts`: the tier break is the account's TOTAL month spend, so
 * the non-row meters are summed first. Rows past the free allowance bill at
 * the base rate while that running total is under the tier, and at the volume
 * rate beyond the point it reaches the tier.
 */
export function estimateMonth(input: MonthInput): MonthEstimate {
	const {
		rows,
		running,
		hasSubgraphs,
		memoryGb,
		storageGb,
		webhookEvents,
		subgraphReads,
	} = input;

	const memoryUsd = running
		? Math.max(
				memoryGb * HOURS_PER_MONTH * MEMORY_USD_PER_GB_HOUR,
				STACK_FLOOR_USD_PER_MONTH[hasSubgraphs ? "subgraphs" : "webhooks"],
			)
		: 0;
	const storageUsd = running ? storageGb * STORAGE_USD_PER_GB_MONTH : 0;
	const webhooksUsd = running ? (webhookEvents / 1e6) * WEBHOOK_USD_PER_M : 0;
	const readsUsd =
		running && hasSubgraphs
			? (Math.max(0, subgraphReads - FREE_SUBGRAPH_READS_PER_MONTH) / 1e6) *
				SUBGRAPH_READ_USD_PER_M
			: 0;
	const fixedUsd = memoryUsd + storageUsd + webhooksUsd + readsUsd;

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
		readsUsd,
		totalUsd: fixedUsd + rowsUsd,
	};
}

export function usd(n: number): string {
	if (Number.isInteger(n)) return `$${n}`;
	const cents = n * 100;
	const wholeCents = Math.abs(cents - Math.round(cents)) < 1e-9;
	return `$${n.toFixed(wholeCents ? 2 : 3)}`;
}

export function usdExact(n: number): string {
	return n.toLocaleString("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
}
