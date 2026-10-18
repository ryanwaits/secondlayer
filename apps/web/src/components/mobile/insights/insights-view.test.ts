import { describe, expect, test } from "bun:test";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import {
	isNewInsight,
	openList,
	resolvedList,
	snoozeUntil,
} from "./insights-view";

describe("snoozeUntil", () => {
	test("late evening snoozes to 09:00 the next day", () => {
		const until = snoozeUntil(new Date(2026, 9, 18, 23, 30));
		expect(until).toEqual(new Date(2026, 9, 19, 9, 0, 0, 0));
	});

	test("just after midnight is still tomorrow, not the coming 09:00", () => {
		const until = snoozeUntil(new Date(2026, 9, 18, 0, 10));
		expect(until).toEqual(new Date(2026, 9, 19, 9, 0, 0, 0));
	});

	test("rolls over a month end", () => {
		const until = snoozeUntil(new Date(2026, 9, 31, 12, 0));
		expect(until).toEqual(new Date(2026, 10, 1, 9, 0, 0, 0));
	});
});

describe("open and resolved lists", () => {
	test("recovered insights go to Resolved and the rest stay Open, worst first", () => {
		const open = openList(FIXTURE_INSIGHTS);
		const resolved = resolvedList(FIXTURE_INSIGHTS);
		expect(open.every((i) => i.severity !== "recovered")).toBe(true);
		expect(resolved.every((i) => i.severity === "recovered")).toBe(true);
		expect(open.length + resolved.length).toBe(FIXTURE_INSIGHTS.length);
		expect(open[0]?.severity).toBe("losing");
	});
});

describe("isNewInsight", () => {
	const open = openList(FIXTURE_INSIGHTS)[0];
	const recovered = resolvedList(FIXTURE_INSIGHTS)[0];
	if (!open || !recovered) throw new Error("fixtures");

	test("new when created after the tab was last seen", () => {
		expect(isNewInsight(open, Date.parse(open.createdAt) - 1)).toBe(true);
		expect(isNewInsight(open, Date.parse(open.createdAt))).toBe(false);
	});

	test("a resolved insight is never new", () => {
		expect(isNewInsight(recovered, 0)).toBe(false);
	});
});
