import { describe, expect, test } from "bun:test";
import {
	booleanConfidence,
	choiceConfidence,
	normalizeAnswer,
	scoreConfidence,
} from "./confidence.ts";

describe("choiceConfidence", () => {
	test("uniform gives 0", () => {
		expect(choiceConfidence({ a: 0.5, b: 0.5 })).toBeCloseTo(0, 10);
	});
	test("one-hot gives 1", () => {
		expect(choiceConfidence({ a: 1, b: 0, c: 0 })).toBeCloseTo(1, 10);
	});
	test("single option gives 1", () => {
		expect(choiceConfidence({ a: 1 })).toBe(1);
	});
	test("matches the kev README example", () => {
		expect(
			choiceConfidence({ returns: 0.47, shipping: 0.28, billing: 0.25 }),
		).toBeCloseTo(0.205, 2);
	});
});

describe("scoreConfidence", () => {
	test("all mass on one level gives 1", () => {
		expect(scoreConfidence({ "0": 0, "1": 1, "2": 0 }, 3)).toBeCloseTo(1, 10);
	});
	test("uniform over 3 levels gives 0", () => {
		const p = { "0": 1 / 3, "1": 1 / 3, "2": 1 / 3 };
		expect(scoreConfidence(p, 3)).toBeCloseTo(0, 10);
	});
	test("matches the kev README example", () => {
		expect(scoreConfidence({ "0": 0, "1": 0.56, "2": 0.44 }, 3)).toBeCloseTo(
			0.34,
			2,
		);
	});
});

describe("booleanConfidence", () => {
	test("0.93 gives 0.86", () => {
		expect(booleanConfidence(0.93)).toBeCloseTo(0.86, 10);
	});
});

describe("normalizeAnswer", () => {
	test("choice without probabilities has confidence 0", () => {
		const a = normalizeAnswer(
			{ type: "choice", instructions: "x", criteria: { a: "a", b: "b" } },
			{ type: "choice", choice: "a" },
		);
		expect(a).toEqual({
			type: "choice",
			choice: "a",
			probabilities: {},
			confidence: 0,
		});
	});
	test("refusal passes through", () => {
		const a = normalizeAnswer(
			{ type: "boolean", instructions: "x", criteria: { true: "", false: "" } },
			{ type: "refusal" },
		);
		expect(a).toEqual({ type: "refusal" });
	});
});
