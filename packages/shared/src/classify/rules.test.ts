import { describe, expect, test } from "bun:test";
import { runRules } from "./rules.ts";
import type { Question } from "./types.ts";

const questions = {
	kind: {
		type: "choice",
		instructions: "x",
		criteria: { a: "a", b: "b" },
	},
	sev: { type: "score", instructions: "x", criteria: ["lo", "mid", "hi"] },
	page: {
		type: "boolean",
		instructions: "x",
		criteria: { true: "t", false: "f" },
	},
} as const satisfies Record<string, Question>;

describe("runRules", () => {
	test("valid values come back one-hot with confidence 1", () => {
		const a = runRules(
			questions,
			() => ({ kind: "b", sev: 2, page: true }),
			"s",
		);
		expect(a.kind).toEqual({
			type: "choice",
			choice: "b",
			probabilities: { a: 0, b: 1 },
			confidence: 1,
		});
		expect(a.sev).toEqual({
			type: "score",
			score: 2,
			probabilities: { "0": 0, "1": 0, "2": 1 },
			confidence: 1,
		});
		expect(a.page).toEqual({ type: "boolean", probability: 1, confidence: 1 });
	});

	test("out-of-range score and unknown choice refuse", () => {
		const a = runRules(questions, () => ({ kind: "zzz", sev: 3 }), "s");
		expect(a.kind).toEqual({ type: "refusal" });
		expect(a.sev).toEqual({ type: "refusal" });
	});

	test("missing key refuses", () => {
		const a = runRules(questions, () => ({ page: false }), "s");
		expect(a.kind).toEqual({ type: "refusal" });
		expect(a.page).toEqual({ type: "boolean", probability: 0, confidence: 1 });
	});

	test("null return refuses everything", () => {
		const a = runRules(questions, () => null, "s");
		expect(Object.values(a).every((x) => x.type === "refusal")).toBe(true);
	});
});
