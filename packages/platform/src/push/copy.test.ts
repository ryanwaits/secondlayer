import { describe, expect, test } from "bun:test";
import {
	PUSH_RULES,
	insightPush,
	replayDonePush,
	subgraphStoppedPush,
	webhookFailingPush,
} from "./copy.ts";

const down = {
	id: "wh_1",
	name: "sbtc-deposits",
	failingSince: new Date("2026-10-17T16:06:30Z"),
	failures: 20,
	lastError: "502 Bad Gateway",
};

describe("webhookFailingPush", () => {
	test("says what failed, since when, and how often", () => {
		expect(webhookFailingPush(down)).toEqual({
			title: "sbtc-deposits can't reach your server",
			body: "502 Bad Gateway since 16:06 UTC. 20 failed attempts in a row.",
			url: "/account/webhooks/wh_1",
			tag: "webhook:wh_1",
		});
	});
	test("a missing error reads as no answer and a long one is cut to 60 chars", () => {
		expect(webhookFailingPush({ ...down, lastError: null }).body).toStartWith(
			"No answer since",
		);
		const long = webhookFailingPush({ ...down, lastError: "x".repeat(200) });
		expect(long.body.startsWith(`${"x".repeat(60)} since`)).toBe(true);
	});
	test("thousands get separators and the id is URL-encoded", () => {
		const p = webhookFailingPush({ ...down, id: "a/b", failures: 1204 });
		expect(p.body).toContain("1,204 failed attempts");
		expect(p.url).toBe("/account/webhooks/a%2Fb");
	});
});

describe("insightPush", () => {
	const base = { line: "Line", lead: "Lead" };
	test("account insights open the page for their rule", () => {
		const url = (rule: string) =>
			insightPush({
				...base,
				rule,
				resource: { kind: "account", id: "account", name: "account" },
			}).url;
		expect(url("stack_unreachable_subgraphs")).toBe("/account/subgraphs");
		expect(url("cap_pace")).toBe("/account/credits");
		expect(url("polling_loop")).toBe("/account/rows");
		expect(url("duplicate_reads")).toBe("/account/rows");
		expect(url("something_else")).toBe("/account");
	});
	test("webhook and subgraph resources open their own page", () => {
		expect(
			insightPush({
				...base,
				rule: "r",
				resource: { kind: "webhook", id: "wh 1", name: "n" },
			}).url,
		).toBe("/account/webhooks/wh%201");
		expect(
			insightPush({
				...base,
				rule: "r",
				resource: { kind: "subgraph", id: "i", name: "sbtc-flows" },
			}).url,
		).toBe("/account/subgraphs/sbtc-flows");
	});
	test("title is the line, body is the lead, tag is per rule and resource", () => {
		const p = insightPush({
			...base,
			rule: "cap_pace",
			resource: { kind: "account", id: "account", name: "account" },
		});
		expect(p.title).toBe("Line");
		expect(p.body).toBe("Lead");
		expect(p.tag).toBe("insight:cap_pace:account");
	});
});

describe("replayDonePush", () => {
	const r = {
		webhookId: "wh_1",
		webhookName: "sbtc-deposits",
		delivered: 3790,
		gaveUp: 22,
		total: 3812,
	};
	test("offers the requeue when some gave up", () => {
		expect(replayDonePush(r)).toEqual({
			title: "Replay done: sbtc-deposits",
			body: "3,790 delivered, 22 gave up. Tap to requeue them.",
			url: "/account/webhooks/wh_1",
			tag: "replay:wh_1",
		});
	});
	test("a clean replay says everything arrived", () => {
		expect(replayDonePush({ ...r, gaveUp: 0, delivered: 3812 }).body).toBe(
			"All 3,812 delivered.",
		);
	});
});

describe("subgraphStoppedPush", () => {
	const e = { subgraph: "sbtc-flows", height: 1204000, lastError: null };
	test("each reason says what happened and what it means", () => {
		const body = (reason: "out_of_memory" | "crashed" | "stalled" | "error") =>
			subgraphStoppedPush({ ...e, reason }).body;
		expect(body("stalled")).toBe(
			"No progress at block 1,204,000. We restarted it 3 times, then halted it.",
		);
		expect(body("out_of_memory")).toBe(
			"It ran out of memory at block 1,204,000 and was halted.",
		);
		expect(body("crashed")).toBe(
			"It crashed at block 1,204,000 and was halted.",
		);
		expect(body("error")).toBe("It hit its error limit. Redeploy to resume.");
	});
	test("an error shows its last error without doubling the period", () => {
		expect(
			subgraphStoppedPush({
				...e,
				reason: "error",
				lastError: "Handler threw on tx 0xab.",
			}).body,
		).toBe("Handler threw on tx 0xab. Redeploy to resume.");
	});
	test("title and url", () => {
		const p = subgraphStoppedPush({ ...e, reason: "crashed" });
		expect(p.title).toBe("sbtc-flows stopped ingesting");
		expect(p.url).toBe("/account/subgraphs");
		expect(p.tag).toBe("subgraph:sbtc-flows");
	});
});

describe("PUSH_RULES", () => {
	test("an unknown rule is not in the map", () => {
		expect(PUSH_RULES.allowance_exhausted).toBeUndefined();
	});
	test("tenant subgraph rules never push", () => {
		expect(PUSH_RULES.subgraph_stopped).toBeUndefined();
		expect(PUSH_RULES.subgraph_handler_errors).toBeUndefined();
	});
});

test("no output contains an em dash and every url is a same-origin path", () => {
	const outputs = [
		webhookFailingPush({
			id: "w",
			name: "n",
			failingSince: new Date(0),
			failures: 5,
			lastError: null,
		}),
		replayDonePush({
			webhookId: "w",
			webhookName: "n",
			delivered: 1,
			gaveUp: 1,
			total: 2,
		}),
		replayDonePush({
			webhookId: "w",
			webhookName: "n",
			delivered: 2,
			gaveUp: 0,
			total: 2,
		}),
		...(["out_of_memory", "crashed", "stalled", "error"] as const).map(
			(reason) =>
				subgraphStoppedPush({
					subgraph: "s",
					reason,
					height: 1,
					lastError: null,
				}),
		),
	];
	for (const o of outputs) {
		expect(JSON.stringify(o)).not.toContain("—");
		expect(o.url.startsWith("/")).toBe(true);
		expect(o.url.startsWith("//")).toBe(false);
	}
});
