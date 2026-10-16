import { describe, expect, test } from "bun:test";
import type { Insight } from "@/lib/insights";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import type { RowsResponse } from "@/lib/rows";
import type { ApiKey } from "@/lib/types";
import { cellInsights, keysCell, rowsCell, stackCell } from "./overview-view";

const NOW = new Date("2026-10-15T12:00:00.000Z");
const daysAgo = (n: number) =>
	new Date(NOW.getTime() - n * 86_400_000).toISOString();

const rowsData = (used: number): RowsResponse => ({
	allowance: {
		monthly: 1_000_000,
		usedThisMonth: used,
		exhaustedOn: used > 1_000_000 ? "2026-10-06" : null,
		paidRowsThisMonth: Math.max(0, used - 1_000_000),
		paidUsdMicrosThisMonth: "0",
		resetsOn: "2026-11-01",
	},
	daily: [],
	hourlyToday: [
		{ hour: "2026-10-15T01:00:00.000Z", source: "index", rows: 40, calls: 2 },
		{ hour: "2026-10-15T09:00:00.000Z", source: "index", rows: 60, calls: 3 },
	],
	bySource: [],
	histogram: [],
	errors: [],
});

describe("rowsCell", () => {
	test("splits free and paid rows once the free 1M is used up", () => {
		const cell = rowsCell(rowsData(1_260_000), NOW);
		expect(cell.free).toBe(1_000_000);
		expect(cell.paid).toBe(260_000);
		expect(cell.today).toBe(100);
		expect(cell.monthLabel).toBe("October");
		expect(cell.caption).toBe("Free 1M used up · 260,000 paid · 100 today");
	});

	test("says how much of the free 1M is used before it runs out", () => {
		const cell = rowsCell(rowsData(400_000), NOW);
		expect(cell.free).toBe(400_000);
		expect(cell.paid).toBe(0);
		expect(cell.caption).toBe("400,000 of 1M free · 100 today");
	});
});

describe("keysCell", () => {
	const key = (patch: Partial<ApiKey>): ApiKey => ({
		id: "k",
		prefix: "sk-sl_abc12345",
		name: "laptop",
		status: "active",
		product: "account",
		tier: null,
		createdAt: daysAgo(100),
		lastUsedAt: daysAgo(0),
		rowsDaily: new Array<number>(30).fill(5),
		...patch,
	});

	test("counts days any key read in the last 24", () => {
		const days = new Array<number>(30).fill(0);
		days[29] = 7;
		days[2] = 2; // older than the 24-day window
		const cell = keysCell([key({ rowsDaily: days })], NOW);
		expect(cell?.days).toHaveLength(24);
		expect(cell?.daysRead).toBe(1);
		expect(cell?.caption).toBe("1 key · read on 1 of the last 24 days");
	});

	test("names the two most recently read keys, then how many more", () => {
		const cell = keysCell(
			[
				key({ id: "a", name: "old", lastUsedAt: daysAgo(5) }),
				key({ id: "b", name: "ci", lastUsedAt: daysAgo(1) }),
				key({ id: "c", name: "laptop", lastUsedAt: daysAgo(0) }),
			],
			NOW,
		);
		expect(cell?.names).toEqual(["laptop", "ci", "+1"]);
	});

	test("names a stale key", () => {
		const cell = keysCell(
			[
				key({ id: "a" }),
				key({ id: "b", name: "old-indexer", lastUsedAt: daysAgo(40) }),
			],
			NOW,
		);
		expect(cell?.stale).toEqual({ name: "old-indexer", days: 40 });
		expect(keysCell([key({ id: "a" })], NOW)?.stale).toBeNull();
	});

	test("is null with no keys of your own", () => {
		expect(keysCell(null, NOW)).toBeNull();
		expect(keysCell([], NOW)).toBeNull();
		expect(keysCell([key({ product: "docs" })], NOW)).toBeNull();
	});
});

describe("stackCell", () => {
	const memory24h = [
		{ hour: "2026-10-15T10:00:00Z", billedGb: 0.25, observedGb: 0.3 },
		{ hour: "2026-10-15T11:00:00Z", billedGb: 0.25, observedGb: null },
	];
	const burn = { rateDayUsdMicros: "330000", windowHours: 24 };

	test("running shows cost per day and memory", () => {
		const cell = stackCell(
			{ state: "running", lastChargedAt: null, memory24h },
			burn,
		);
		expect(cell).toMatchObject({
			tone: "ok",
			word: "running",
			perDay: "$0.33",
			gb: "0.25",
			points: [0.3, 0.25],
			caption: "0.25 GB · runs your webhooks",
		});
	});

	test("stopped is alarm with the add-credits caption", () => {
		const cell = stackCell(
			{ state: "stopped", lastChargedAt: null, memory24h },
			null,
		);
		expect(cell).toMatchObject({
			tone: "alarm",
			word: "stopped",
			perDay: "$0.00",
			caption: "Add credits to start it again.",
		});
	});

	test("none is idle and not started", () => {
		const cell = stackCell(
			{ state: "none", lastChargedAt: null, memory24h: [] },
			burn,
		);
		expect(cell).toMatchObject({
			tone: "idle",
			word: "not started",
			perDay: null,
			points: [],
			caption: "Starts with your first webhook.",
		});
	});

	test("is null until the usage response loads", () => {
		expect(stackCell(null, burn)).toBeNull();
	});
});

describe("cellInsights", () => {
	const fixture = (rule: string): Insight => {
		const found = FIXTURE_INSIGHTS.find((i) => i.rule === rule);
		if (!found) throw new Error(`missing fixture ${rule}`);
		return found;
	};

	test("puts server errors in the rows cell and leaves money insights for the month", () => {
		const serverErrors: Insight = {
			...fixture("cap_pace"),
			id: "ins-server-errors",
			rule: "server_errors",
		};
		const cap = fixture("cap_pace");
		const split = cellInsights([cap, serverErrors]);
		expect(split.rows.map((i) => i.id)).toEqual(["ins-server-errors"]);
		expect(split.rest.map((i) => i.id)).toEqual([cap.id]);
	});
});
