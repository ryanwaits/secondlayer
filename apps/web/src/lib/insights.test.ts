import { describe, expect, test } from "bun:test";
import {
	type Insight,
	autoOpenId,
	causeText,
	insightHref,
	insightTargetName,
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

describe("insightHref", () => {
	const account = (rule: string): Insight =>
		make({ rule, resource: { kind: "account", id: "a", name: "Account" } });

	test("webhooks and subgraphs link to their own page", () => {
		expect(
			insightHref(
				make({ resource: { kind: "webhook", id: "wh 1", name: "x" } }),
			),
		).toBe("/account/webhooks/wh%201");
		expect(
			insightHref(
				make({ resource: { kind: "subgraph", id: "sg", name: "x" } }),
			),
		).toBe("/account/subgraphs/sg");
	});

	test("every account rule lands on the page that explains it", () => {
		const expected: Record<string, string> = {
			server_errors: "/account/rows",
			duplicate_reads: "/account/rows",
			polling_loop: "/account/rows",
			backfill: "/account/rows",
			allowance_exhausted: "/account/rows",
			key_unused: "/account/keys",
			revoked_key_in_use: "/account/keys",
			cap_pace: "/account/credits",
			credits_runway: "/account/credits",
			stack_unreachable_webhooks: "/account/webhooks",
			stack_unreachable_subgraphs: "/account/subgraphs",
		};
		for (const [rule, href] of Object.entries(expected)) {
			expect(insightHref(account(rule)), rule).toBe(href);
		}
	});

	test("an unknown account rule falls back to the overview", () => {
		expect(insightHref(account("brand_new_rule"))).toBe("/account");
		expect(insightTargetName(account("brand_new_rule"))).toBe("Overview");
	});

	test("the button names the resource, or the page for an account rule", () => {
		expect(insightTargetName(account("key_unused"))).toBe("Keys");
		expect(insightTargetName(byRule("receiver_down"))).toBe("sbtc-deposits");
	});
});
