import { describe, expect, test } from "bun:test";
import {
	type Insight,
	autoOpenId,
	causeText,
	rankInsights,
	severityDot,
} from "./insights";
import { FIXTURE_INSIGHTS, FIXTURE_STACK } from "./insights.fixtures";

const byRule = (rule: string): Insight => {
	const found = FIXTURE_INSIGHTS.find((i) => i.rule === rule);
	if (!found) throw new Error(`missing fixture ${rule}`);
	return found;
};

const make = (over: Partial<Insight>): Insight => ({
	...byRule("duplicate_webhook"),
	...over,
});

describe("rankInsights", () => {
	test("orders the stack story worst first", () => {
		expect(rankInsights(FIXTURE_STACK).map((i) => i.rule)).toEqual([
			"receiver_down",
			"tls_expiring",
			"duplicate_webhook",
			"retries_recovered",
		]);
	});

	test("breaks severity ties by impact, then newest first", () => {
		const a = make({ id: "a", impact: 5, createdAt: "2026-10-01T00:00:00Z" });
		const b = make({ id: "b", impact: 9, createdAt: "2026-10-01T00:00:00Z" });
		const c = make({ id: "c", impact: 9, createdAt: "2026-10-02T00:00:00Z" });
		expect(rankInsights([a, b, c]).map((i) => i.id)).toEqual(["c", "b", "a"]);
	});

	test("does not mutate its input", () => {
		const input = [...FIXTURE_STACK];
		rankInsights(input);
		expect(input.map((i) => i.id)).toEqual(FIXTURE_STACK.map((i) => i.id));
	});
});

describe("autoOpenId", () => {
	test("opens the top item when it is losing events", () => {
		expect(autoOpenId(FIXTURE_STACK)).toBe(byRule("receiver_down").id);
	});

	test("opens a top will_fail item", () => {
		expect(
			autoOpenId([byRule("tls_expiring"), byRule("retries_recovered")]),
		).toBe(byRule("tls_expiring").id);
	});

	test("opens nothing for only costs and recovered", () => {
		expect(
			autoOpenId([byRule("duplicate_webhook"), byRule("retries_recovered")]),
		).toBeNull();
	});

	test("opens nothing for an empty list", () => {
		expect(autoOpenId([])).toBeNull();
	});
});

describe("causeText", () => {
	const how = (confidence: number): Insight["how"] => ({
		detector: "d",
		facts: [],
		label: { cause: "dns_timeout", confidence },
	});

	test("shows the cause at exactly 0.85", () => {
		expect(causeText(how(0.85))).toBe("dns_timeout");
	});

	test("hides the cause at 0.849", () => {
		expect(causeText(how(0.849))).toBeNull();
	});

	test("is null without a label", () => {
		expect(causeText({ detector: "d", facts: [] })).toBeNull();
	});
});

describe("severityDot", () => {
	test("maps each severity to its dot modifier", () => {
		expect(severityDot("losing")).toBe("alarm");
		expect(severityDot("will_fail")).toBe("hi");
		expect(severityDot("costs")).toBe("costs");
		expect(severityDot("recovered")).toBe("idle");
	});
});
