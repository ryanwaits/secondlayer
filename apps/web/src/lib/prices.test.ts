import { describe, expect, test } from "bun:test";
import {
	COMMIT_TIER_MONTHLY_USD_MICROS,
	CREDIT_USD_MICROS_PER_ROW_VOLUME,
	HOURS_PER_MONTH,
	PRICES,
	ROWS_DELIVERED_MONTHLY_ALLOWANCE,
	STACK_FLOOR_USD_MICROS_PER_MONTH,
	stackMemoryFloorGb,
} from "../../../../packages/platform/src/billing/prices";
import * as web from "./prices";

const usd = (units: bigint) => Number(units) / 1_000_000;

describe("web price mirror matches the platform table", () => {
	test("per-1M prices equal micros per unit", () => {
		expect(Number(PRICES["rows.delivered"])).toBe(web.ROW_USD_PER_M);
		expect(Number(PRICES["webhook.event"])).toBe(web.WEBHOOK_USD_PER_M);
		expect(Number(CREDIT_USD_MICROS_PER_ROW_VOLUME)).toBe(
			web.ROW_USD_PER_M_VOLUME,
		);
	});

	test("per-unit prices equal micros converted to dollars", () => {
		expect(usd(PRICES["memory.gb_hour"])).toBe(web.MEMORY_USD_PER_GB_HOUR);
		expect(usd(PRICES["archive.partition"])).toBe(web.ARCHIVE_PARTITION_USD);
		expect(usd(PRICES["archive.partition.events"])).toBe(
			web.ARCHIVE_EVENTS_PARTITION_USD,
		);
		expect(usd(COMMIT_TIER_MONTHLY_USD_MICROS)).toBe(
			web.VOLUME_TIER_MONTHLY_USD,
		);
	});

	test("storage month is the daily price times 30, rounded to the quoted $0.25", () => {
		expect(web.STORAGE_USD_PER_GB_MONTH).toBeCloseTo(
			(Number(PRICES["storage.gb_day"]) * 30) / 1e6,
			3,
		);
	});

	test("free monthly row allowance matches", () => {
		expect(ROWS_DELIVERED_MONTHLY_ALLOWANCE).toBe(web.FREE_ROWS_PER_MONTH);
	});

	test("stack floors match in dollars, and so does the GB they bill as", () => {
		expect(usd(STACK_FLOOR_USD_MICROS_PER_MONTH.webhooks)).toBe(
			web.STACK_FLOOR_USD_PER_MONTH.webhooks,
		);
		expect(usd(STACK_FLOOR_USD_MICROS_PER_MONTH.subgraphs)).toBe(
			web.STACK_FLOOR_USD_PER_MONTH.subgraphs,
		);
		expect(HOURS_PER_MONTH).toBe(web.HOURS_PER_MONTH);
		for (const hasSubgraphs of [false, true]) {
			expect(web.stackMemoryFloorGb(hasSubgraphs)).toBeCloseTo(
				stackMemoryFloorGb(hasSubgraphs),
				9,
			);
		}
	});

	test("constants in files web cannot import still hold their value", async () => {
		const api = await Bun.file(
			`${import.meta.dir}/../../../../packages/api/src/routes/archive.ts`,
		).text();
		expect(api).toMatch(/ALLOWANCE_MONTHLY_PARTITIONS = 18;/);
		expect(web.FREE_REPAIR_PARTITIONS_PER_MONTH).toBe(18);
		const billing = await Bun.file(
			`${import.meta.dir}/../../../../packages/api/src/routes/billing.ts`,
		).text();
		expect(billing).toMatch(/CREDIT_PACKS_USD = \[10, 25, 50, 100\] as const;/);
		expect(web.CREDIT_PACKS_USD).toEqual([10, 25, 50, 100]);
	});
});

const idle = {
	rows: 0,
	running: false,
	hasSubgraphs: false,
	memoryGb: 0.2,
	storageGb: 0,
	webhookEvents: 0,
};

describe("estimateMonth", () => {
	test("no usage costs nothing", () => {
		expect(web.estimateMonth(idle).totalUsd).toBe(0);
	});

	test("the first million rows are free", () => {
		expect(web.estimateMonth({ ...idle, rows: 1_000_000 }).totalUsd).toBe(0);
	});

	test("two million rows bill one million at the base rate", () => {
		expect(
			web.estimateMonth({ ...idle, rows: 2_000_000 }).totalUsd,
		).toBeCloseTo(5, 6);
	});

	test("a stopped stack bills no memory, storage or webhooks", () => {
		const e = web.estimateMonth({
			...idle,
			memoryGb: 4,
			storageGb: 1,
			webhookEvents: 5e6,
		});
		expect(e.memoryUsd).toBe(0);
		expect(e.storageUsd).toBe(0);
		expect(e.webhooksUsd).toBe(0);
	});

	test("one million webhook events cost $10", () => {
		const e = web.estimateMonth({
			...idle,
			running: true,
			webhookEvents: 1_000_000,
		});
		expect(e.webhooksUsd).toBeCloseTo(10, 6);
	});

	test("a running webhook-only stack under the floor estimates $5.00/mo", () => {
		const e = web.estimateMonth({ ...idle, running: true, memoryGb: 0.2 });
		expect(e.memoryUsd).toBe(5);
	});

	test("a running stack with subgraphs under the floor estimates $10.00/mo", () => {
		const e = web.estimateMonth({
			...idle,
			running: true,
			hasSubgraphs: true,
			memoryGb: 0.2,
		});
		expect(e.memoryUsd).toBe(10);
	});

	test("a stack above its floor estimates the memory it uses", () => {
		const e = web.estimateMonth({ ...idle, running: true, memoryGb: 1 });
		expect(e.memoryUsd).toBeCloseTo(20.44, 2);
	});

	test("rows switch to the volume rate once total spend reaches $50", () => {
		const e = web.estimateMonth({
			...idle,
			running: true,
			hasSubgraphs: true,
			rows: 11_000_000,
		});
		// $10 memory leaves $40 of room: 8M rows at $5, the rest at $2.
		expect(e.volumeRows).toBeCloseTo(2_000_000, -2);
		expect(e.volumeUsd).toBeCloseTo(4, 2);
		expect(e.totalUsd).toBeCloseTo(10 + 40 + 4, 2);
	});

	test("a stack already past $50 bills every billable row at the volume rate", () => {
		const e = web.estimateMonth({
			...idle,
			running: true,
			memoryGb: 3,
			rows: 2_000_000,
		});
		expect(e.memoryUsd).toBeGreaterThan(50);
		expect(e.rowsUsd).toBeCloseTo(2, 6);
	});
});

describe("usd formatting", () => {
	test("whole dollars drop cents, fractions keep what they need", () => {
		expect(web.usd(5)).toBe("$5");
		expect(web.usd(0.05)).toBe("$0.05");
		expect(web.usd(0.028)).toBe("$0.028");
		expect(web.usd(10.22)).toBe("$10.22");
	});

	test("statement amounts always show cents", () => {
		expect(web.usdExact(25)).toBe("$25.00");
		expect(web.usdExact(1234.5)).toBe("$1,234.50");
	});
});
