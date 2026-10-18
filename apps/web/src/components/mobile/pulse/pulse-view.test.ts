import { describe, expect, test } from "bun:test";
import type { Billing, Caps } from "@/lib/account-data";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import type { WebhooksActivitySummary } from "@/lib/webhooks-data";
import {
	healthyLine,
	isNewAccount,
	last24,
	needsYou,
	spendLine,
	todayEvents,
	updatedLabel,
} from "./pulse-view";

const hoursFrom = (start: string, count: number): string[] =>
	Array.from({ length: count }, (_, i) =>
		new Date(Date.parse(start) + i * 3_600_000).toISOString(),
	);

const billing = (micros: string): Billing => ({
	creditsUsdMicros: "0",
	spentThisMonthUsdMicros: micros,
});
const caps = (cents: number | null): Caps => ({
	monthlyCapCents: cents,
	alertThresholdPct: 80,
	frozenAt: null,
	alertSentAt: null,
});

describe("needsYou", () => {
	test("keeps only losing and will-fail insights", () => {
		const result = needsYou(FIXTURE_INSIGHTS);
		expect(result.length).toBeGreaterThan(0);
		for (const i of result) {
			expect(["losing", "will_fail"]).toContain(i.severity);
		}
		expect(FIXTURE_INSIGHTS.some((i) => i.severity === "costs")).toBe(true);
		expect(FIXTURE_INSIGHTS.some((i) => i.severity === "recovered")).toBe(true);
	});
});

describe("last24", () => {
	test("sums webhooks hour by hour and keeps the last 24 hours", () => {
		const hours = hoursFrom("2026-10-16T00:00:00.000Z", 48);
		const summary: WebhooksActivitySummary = {
			hours,
			webhooks: [
				{
					id: "a",
					delivered: hours.map(() => 2),
					failed: hours.map((_, i) => (i === 47 ? 3 : 0)),
				},
				{
					id: "b",
					delivered: hours.map(() => 5),
					failed: hours.map((_, i) => (i === 47 ? 1 : 0)),
				},
			],
		};
		const result = last24(summary);
		expect(result.hours).toEqual(hours.slice(24));
		expect(result.delivered).toHaveLength(24);
		expect(result.delivered.every((n) => n === 7)).toBe(true);
		expect(result.failed.at(-1)).toBe(4);
		expect(result.failed[0]).toBe(0);
	});

	test("is empty before the summary loads", () => {
		expect(last24(undefined)).toEqual({ delivered: [], failed: [], hours: [] });
	});
});

describe("todayEvents", () => {
	test("counts delivered and failed since 00:00 UTC, not yesterday", () => {
		const hours = hoursFrom("2026-10-17T22:00:00.000Z", 6);
		const summary: WebhooksActivitySummary = {
			hours,
			webhooks: [
				{
					id: "a",
					delivered: [100, 100, 10, 10, 10, 10],
					failed: [50, 50, 1, 0, 0, 1],
				},
			],
		};
		expect(todayEvents(summary, new Date("2026-10-18T03:30:00.000Z"))).toBe(42);
	});
});

describe("spendLine", () => {
	test("shows spend against a whole-dollar cap", () => {
		expect(spendLine(billing("40100000"), caps(5000))).toBe("$40.10 of $50");
	});

	test("shows two decimals for a fractional cap", () => {
		expect(spendLine(billing("40100000"), caps(5050))).toBe("$40.10 of $50.50");
	});

	test("says no cap when none is set", () => {
		expect(spendLine(billing("40100000"), caps(null))).toBe("$40.10 · no cap");
		expect(spendLine(billing("40100000"), null)).toBe("$40.10 · no cap");
	});

	test("is null before billing loads", () => {
		expect(spendLine(null, caps(5000))).toBeNull();
	});
});

describe("healthyLine", () => {
	test("uses singular and plural nouns", () => {
		expect(healthyLine(1, 1)).toBe(
			"1 webhook, 1 subgraph. Nothing failed in 24 h.",
		);
		expect(healthyLine(4, 3)).toBe(
			"4 webhooks, 3 subgraphs. Nothing failed in 24 h.",
		);
	});
});

describe("isNewAccount", () => {
	test("is true only when both lists loaded and are empty", () => {
		expect(isNewAccount([], [])).toBe(true);
		expect(isNewAccount([], null)).toBe(false);
		expect(isNewAccount(null, [])).toBe(false);
		expect(isNewAccount([], undefined)).toBe(false);
		expect(isNewAccount([{}], [])).toBe(false);
	});
});

describe("updatedLabel", () => {
	test("reads just now, seconds, then minutes", () => {
		const now = 1_000_000;
		expect(updatedLabel(now - 4_000, now)).toBe("just now");
		expect(updatedLabel(now - 42_000, now)).toBe("42s ago");
		expect(updatedLabel(now - 190_000, now)).toBe("3 min ago");
	});
});
