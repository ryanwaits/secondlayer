import { describe, expect, test } from "bun:test";
import type { Answer } from "@secondlayer/shared/classify";
import {
	EXPECTED_MAX,
	FEEDBACK_KINDS,
	type FeedbackKind,
	type FeedbackTicketInput,
	INTENT_MAX,
	MODEL_ROUTING_ENABLED,
	buildFeedbackState,
	route,
	rulesFor,
} from "./feedback-classify-core.ts";

function ticket(over: Partial<FeedbackTicketInput> = {}): FeedbackTicketInput {
	return {
		id: "t1",
		intent: "I wanted sender filter",
		expected: null,
		kind_hint: null,
		evidence: null,
		attempted: null,
		origin: "mcp",
		...over,
	};
}

function answers(o: {
	choice?: string;
	confidence?: number;
	risk?: number;
	evidence?: number;
}) {
	return {
		kind: {
			type: "choice",
			choice: o.choice ?? "docs_mismatch",
			probabilities: {},
			confidence: o.confidence ?? 0.95,
		} as Answer,
		risk: {
			type: "score",
			score: o.risk ?? 0,
			probabilities: {},
			confidence: 0.9,
		} as Answer,
		has_chain_evidence: {
			type: "boolean",
			probability: o.evidence ?? 0,
			confidence: 0.9,
		} as Answer,
	};
}

describe("buildFeedbackState", () => {
	test("keeps query param names but drops their values", () => {
		const state = buildFeedbackState(
			ticket({
				attempted: {
					method: "GET",
					path: "/v1/index/transfers",
					status: 400,
					code: "INVALID_PARAM",
					query: { sender: "SP2C2XYZ", asset: "aeUSDC" },
				},
			}),
		);
		expect(state.attempted?.query_params).toEqual(["asset", "sender"]);
		const json = JSON.stringify(state);
		expect(json).not.toContain("aeUSDC");
		expect(json).not.toContain("SP2C2XYZ");
	});

	test("caps intent and expected text", () => {
		const state = buildFeedbackState(
			ticket({
				intent: "a".repeat(INTENT_MAX + 100),
				expected: { v: "b".repeat(EXPECTED_MAX + 100) },
			}),
		);
		expect(state.intent).toHaveLength(INTENT_MAX);
		expect(state.expected).toHaveLength(EXPECTED_MAX);
	});
});

describe("rulesFor", () => {
	test("401 routes to low_priority as auth", () => {
		expect(rulesFor(ticket({ attempted: { status: 401 } }))).toEqual({
			kind: "not_a_ticket",
			route: "low_priority",
			rule: "auth",
		});
	});
	test("KEY_ROTATED code routes as auth", () => {
		expect(rulesFor(ticket({ attempted: { code: "KEY_ROTATED" } }))?.rule).toBe(
			"auth",
		);
	});
	test("INVALID_COLUMN routes to schema_gap", () => {
		expect(rulesFor(ticket({ attempted: { code: "INVALID_COLUMN" } }))).toEqual(
			{ kind: "schema_gap", route: "schema_gap", rule: "missing_column" },
		);
	});
	test("TABLE_NOT_FOUND routes to schema_gap", () => {
		expect(
			rulesFor(ticket({ attempted: { code: "TABLE_NOT_FOUND" } }))?.route,
		).toBe("schema_gap");
	});
	test("bug hint with tx id routes to decode_fixture", () => {
		expect(
			rulesFor(ticket({ kind_hint: "bug", evidence: { tx_id: "0xabc" } })),
		).toEqual({ kind: "bug", route: "decode_fixture", rule: "bug_with_tx" });
	});
	test("bug hint without tx id is undecided", () => {
		expect(rulesFor(ticket({ kind_hint: "bug", evidence: {} }))).toBeNull();
	});
	test("PAYMENT_REQUIRED is left to a human", () => {
		expect(
			rulesFor(
				ticket({ attempted: { code: "PAYMENT_REQUIRED", status: 402 } }),
			),
		).toBeNull();
	});
});

describe("route", () => {
	test("rule hit ignores contradicting model answers", () => {
		const d = route({
			ticket: ticket(),
			rules: {
				kind: "schema_gap",
				route: "schema_gap",
				rule: "missing_column",
			},
			provider: "jev",
			answers: answers({ choice: "docs_mismatch" }),
		});
		expect(d).toEqual({
			route: "schema_gap",
			reason: "rule:missing_column",
			kind: "schema_gap",
		});
	});

	test("null answers fail open to human", () => {
		expect(
			route({ ticket: ticket(), rules: null, provider: null, answers: null }),
		).toEqual({ route: "human", reason: "fail_open", kind: null });
	});

	test("refusal on any question goes to human", () => {
		const a = answers({});
		for (const key of ["kind", "risk", "has_chain_evidence"] as const) {
			const d = route({
				ticket: ticket(),
				rules: null,
				provider: "jev",
				answers: { ...a, [key]: { type: "refusal" } },
			});
			expect(d.route).toBe("human");
			expect(d.reason).toBe("refusal");
		}
	});

	test("dangerous risk overrides a confident docs_mismatch", () => {
		const d = route({
			ticket: ticket(),
			rules: null,
			provider: "jev",
			answers: answers({ risk: 1.8 }),
		});
		expect(d.route).toBe("human");
		expect(d.reason).toBe("dangerous");
	});

	test("jev confidence 0.84 stays human, 0.86 routes", () => {
		const low = route({
			ticket: ticket(),
			rules: null,
			provider: "jev",
			answers: answers({ confidence: 0.84 }),
		});
		expect(low.reason).toBe("low_confidence");
		const high = route({
			ticket: ticket(),
			rules: null,
			provider: "jev",
			answers: answers({ confidence: 0.86 }),
		});
		expect(high.route).toBe("docs");
	});

	test("schema_gap choice routes to schema_gap", () => {
		expect(
			route({
				ticket: ticket(),
				rules: null,
				provider: "kev",
				answers: answers({ choice: "schema_gap" }),
			}).route,
		).toBe("schema_gap");
	});

	test("bug with chain evidence and tx id routes to decode_fixture", () => {
		const d = route({
			ticket: ticket({ evidence: { tx_id: "0xabc" } }),
			rules: null,
			provider: "jev",
			answers: answers({ choice: "bug", evidence: 0.9 }),
		});
		expect(d.route).toBe("decode_fixture");
	});

	test("bug without a tx id stays human", () => {
		const d = route({
			ticket: ticket(),
			rules: null,
			provider: "jev",
			answers: answers({ choice: "bug", evidence: 0.99 }),
		});
		expect(d.route).toBe("human");
		expect(d.reason).toBe("bug_without_evidence");
	});

	test("missing_capability and perf stay human", () => {
		for (const choice of ["missing_capability", "perf", "unknown_kind"]) {
			const d = route({
				ticket: ticket(),
				rules: null,
				provider: "jev",
				answers: answers({ choice }),
			});
			expect(d.route).toBe("human");
			expect(d.reason).toBe(`kind:${choice}`);
		}
	});

	test("confident not_a_ticket stays human while model routing is disabled", () => {
		expect(MODEL_ROUTING_ENABLED).toBe(false);
		const d = route({
			ticket: ticket(),
			rules: null,
			provider: "jev",
			answers: answers({ choice: "not_a_ticket", confidence: 1 }),
		});
		expect(d).toEqual({
			route: "human",
			reason: "model_routing_disabled",
			kind: "not_a_ticket",
		});
	});

	test("the model never produces low_priority in v1", () => {
		for (const choice of Object.keys(FEEDBACK_KINDS) as FeedbackKind[]) {
			for (const evidence of [0, 1]) {
				const d = route({
					ticket: ticket({ evidence: { tx_id: "0xabc" } }),
					rules: null,
					provider: "jev",
					answers: answers({ choice, confidence: 1, risk: 0, evidence }),
				});
				expect(d.route).not.toBe("low_priority");
			}
		}
	});
});
