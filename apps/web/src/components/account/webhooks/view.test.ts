import { describe, expect, test } from "bun:test";
import {
	deliveryStats,
	groupAttempts,
	hourWindow,
	listRowState,
	outageStartIndex,
	rangeBars,
} from "./view";
import {
	FIXTURE_HOURS,
	activityFor,
	attempt,
	summary,
} from "./webhook.fixtures";

const flat = (n: number) => new Array<number>(168).fill(n);

describe("listRowState", () => {
	test("a healthy webhook reads what it delivered in the last day", () => {
		const state = listRowState(
			summary(),
			{ delivered: flat(2), failed: flat(0) },
			FIXTURE_HOURS,
		);
		expect(state).toEqual({
			tone: "ok",
			text: "Delivered 48 in 24h",
			bad: false,
		});
	});

	test("failures with no deliveries since read as an outage start", () => {
		const delivered = flat(2);
		const failed = flat(0);
		for (let i = 160; i < 168; i++) {
			delivered[i] = 0;
			failed[i] = 3;
		}
		const state = listRowState(summary(), { delivered, failed }, FIXTURE_HOURS);
		expect(state.tone).toBe("alarm");
		expect(state.bad).toBe(true);
		expect(state.text).toContain("Failing since");
		expect(state.text).toContain("24 attempts failed");
	});

	test("paused by the user is idle, never an outage", () => {
		const state = listRowState(
			summary({ status: "paused" }),
			undefined,
			FIXTURE_HOURS,
		);
		expect(state.tone).toBe("idle");
		expect(state.text).toBe("Paused");
	});

	test("a tripped breaker reads as failing without any activity data", () => {
		const state = listRowState(
			summary({ status: "paused", circuitOpenedAt: "2026-10-15T10:00:00Z" }),
			undefined,
			[],
		);
		expect(state.tone).toBe("alarm");
	});
});

describe("groupAttempts", () => {
	test("three attempts at one event make one group with three attempts", () => {
		const rows = [
			attempt({ id: "d3", attempt: 3, dispatchedAt: "2026-10-15T12:12:00Z" }),
			attempt({ id: "d2", attempt: 2, dispatchedAt: "2026-10-15T12:11:00Z" }),
			attempt({ id: "d1", attempt: 1, dispatchedAt: "2026-10-15T12:10:00Z" }),
		];
		const groups = groupAttempts(rows);
		expect(groups).toHaveLength(1);
		expect(groups[0]?.attempts.map((a) => a.attempt)).toEqual([1, 2, 3]);
		expect(groups[0]?.latest.id).toBe("d3");
	});

	test("rows without a block, tx and index each stand alone", () => {
		const rows = [
			attempt({ id: "t1", blockHeight: null }),
			attempt({ id: "t2", blockHeight: null }),
		];
		expect(groupAttempts(rows)).toHaveLength(2);
	});

	test("groups keep the newest-first order of the input", () => {
		const rows = [
			attempt({ id: "a", eventIndex: 1 }),
			attempt({ id: "b", eventIndex: 2 }),
			attempt({ id: "c", eventIndex: 1, attempt: 2 }),
		];
		expect(groupAttempts(rows).map((g) => g.latest.id)).toEqual(["c", "b"]);
	});
});

describe("deliveryStats", () => {
	test("counts retries and takes percentiles of successful durations", () => {
		const rows = [
			attempt({ id: "a", durationMs: 100 }),
			attempt({ id: "b", durationMs: 200 }),
			attempt({ id: "c", durationMs: 300, attempt: 2 }),
			attempt({ id: "d", durationMs: 9_000, statusCode: 502 }),
		];
		expect(deliveryStats(rows)).toEqual({ retried: 1, p50: 200, p95: 300 });
	});

	test("no successes leaves the percentiles empty", () => {
		expect(deliveryStats([attempt({ statusCode: 502 })])).toEqual({
			retried: 0,
			p50: null,
			p95: null,
		});
	});
});

describe("hourWindow", () => {
	test("snaps to the UTC hour and labels it", () => {
		const window = hourWindow("2026-10-08T16:40:00Z");
		expect(window?.from).toBe("2026-10-08T16:00:00.000Z");
		expect(window?.to).toBe("2026-10-08T17:00:00.000Z");
		expect(window?.label).toBe("Thu, Oct 8 · 16:00–17:00 UTC");
	});

	test("a missing or unparseable value is no filter", () => {
		expect(hourWindow(null)).toBeNull();
		expect(hourWindow("soon")).toBeNull();
	});
});

describe("rangeBars", () => {
	test("hourly ranges slice the newest hours and map the usual band onto each UTC hour", () => {
		const usual = Array.from({ length: 24 }, (_, hour) => ({
			lo: hour,
			hi: hour + 10,
		}));
		const activity = activityFor(5, { usualByHourOfDay: usual });
		const bars = rangeBars("24h", activity, undefined);
		expect(bars.rows).toHaveLength(24);
		expect(bars.offset).toBe(144);
		const firstHour = new Date(activity.hours[144]?.hour ?? "").getUTCHours();
		expect(bars.band?.[0]).toEqual([firstHour, firstHour + 10]);
	});

	test("every hourly bar gets a weekday and UTC clock tooltip heading", () => {
		const activity = activityFor(5);
		const bars = rangeBars("48h", activity, undefined);
		expect(bars.pointLabels).toHaveLength(48);
		expect(bars.pointLabels[0]).toMatch(/^[A-Z][a-z]{2} \d{2}:00 UTC$/);
	});

	test("7d has no band, and 30d reads the daily counts", () => {
		const activity = activityFor(5);
		expect(rangeBars("7d", activity, undefined).band).toBeNull();
		const days = Array.from({ length: 30 }, (_, i) => ({
			day: `2026-09-${String((i % 28) + 1).padStart(2, "0")}`,
			delivered: i,
			failed: 0,
		}));
		const month = rangeBars("30d", activity, days);
		expect(month.rows).toHaveLength(30);
		expect(month.rows[29]?.n).toBe(29);
		expect(month.pointLabels[0]).toBe("Sep 1");
	});
});

describe("outageStartIndex", () => {
	const hour = (delivered: number, failed: number) => ({ delivered, failed });

	test("finds where the trailing run of failing hours begins", () => {
		const hours = [hour(5, 0), hour(4, 1), hour(0, 6), hour(0, 9), hour(0, 3)];
		expect(outageStartIndex(hours)).toBe(2);
	});

	test("skips idle hours at the end", () => {
		expect(outageStartIndex([hour(5, 0), hour(0, 6), hour(0, 0)])).toBe(1);
	});

	test("null when the newest active hour delivered", () => {
		expect(outageStartIndex([hour(0, 6), hour(5, 0)])).toBeNull();
	});
});
