import { beforeEach, describe, expect, test } from "bun:test";
import type { classify } from "../classify/index.ts";
import { maybeLabel, resetLabelCache } from "./label.ts";
import type { DetectedInsight } from "./types.ts";

function insight(rule = "receiver_down"): DetectedInsight {
	return {
		rule,
		severity: "losing",
		impact: 5,
		resource: { kind: "webhook", id: "w1", name: "mint-alerts" },
		line: "line",
		lead: "lead",
		body: "body",
		evidence: [
			{
				kind: "shapes",
				title: "t",
				shapes: [{ code: "502", body: "bad gateway", count: 5, isNew: true }],
			},
		],
		handoff: { prompt: "p", commands: [] },
		how: { detector: "d", facts: [["consecutive failures", "5"]] },
	};
}

function fake(confidence: number | null, choice = "receiver_down") {
	const state = { calls: 0 };
	const classifyFn = (async () => {
		state.calls++;
		if (confidence === null) return null;
		return {
			provider: "jev",
			modelId: "fake",
			answers: {
				cause: { type: "choice", choice, probabilities: {}, confidence },
			},
		};
	}) as unknown as typeof classify;
	return { classifyFn, state };
}

const ON = { INSIGHTS_MODEL_LABELS: "on" };

beforeEach(() => resetLabelCache());

describe("maybeLabel", () => {
	test("is off by default and makes no call", async () => {
		const { classifyFn, state } = fake(0.99);
		const out = await maybeLabel(insight(), { classifyFn, env: {} });
		expect(state.calls).toBe(0);
		expect(out.how.label).toBeUndefined();
	});

	test("attaches a cause at confidence 0.9", async () => {
		const { classifyFn } = fake(0.9);
		const out = await maybeLabel(insight(), { classifyFn, env: ON });
		expect(out.how.label).toEqual({ cause: "receiver_down", confidence: 0.9 });
	});

	test("attaches at exactly 0.85", async () => {
		const { classifyFn } = fake(0.85);
		const out = await maybeLabel(insight(), { classifyFn, env: ON });
		expect(out.how.label?.confidence).toBe(0.85);
	});

	test("does not attach at 0.84", async () => {
		const { classifyFn } = fake(0.84);
		const out = await maybeLabel(insight(), { classifyFn, env: ON });
		expect(out.how.label).toBeUndefined();
	});

	test("does not attach the unknown cause", async () => {
		const { classifyFn } = fake(0.99, "unknown");
		const out = await maybeLabel(insight(), { classifyFn, env: ON });
		expect(out.how.label).toBeUndefined();
	});

	test("leaves the insight unchanged when the provider is down", async () => {
		const { classifyFn } = fake(null);
		const original = insight();
		const out = await maybeLabel(original, { classifyFn, env: ON });
		expect(out).toEqual(original);
	});

	test("never changes any field except how.label", async () => {
		const { classifyFn } = fake(0.95);
		const original = insight();
		const out = await maybeLabel(original, { classifyFn, env: ON });
		expect({ ...out, how: { ...out.how, label: undefined } }).toEqual({
			...original,
			how: { ...original.how, label: undefined },
		});
	});

	test("skips rules that are not receiver rules", async () => {
		const { classifyFn, state } = fake(0.99);
		const out = await maybeLabel(insight("subgraph_lag"), {
			classifyFn,
			env: ON,
		});
		expect(state.calls).toBe(0);
		expect(out.how.label).toBeUndefined();
	});

	test("caches an outcome for 6 hours", async () => {
		const { classifyFn, state } = fake(0.9);
		const now = Date.now();
		await maybeLabel(insight(), { classifyFn, env: ON, now });
		await maybeLabel(insight(), {
			classifyFn,
			env: ON,
			now: now + 5 * 3600_000,
		});
		expect(state.calls).toBe(1);
		await maybeLabel(insight(), {
			classifyFn,
			env: ON,
			now: now + 7 * 3600_000,
		});
		expect(state.calls).toBe(2);
	});
});
