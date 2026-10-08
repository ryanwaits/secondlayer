import { describe, expect, test } from "bun:test";
import { stateSize, validateQuestions } from "./limits.ts";
import { ClassifierInputError, type Question } from "./types.ts";

const bool: Question = {
	type: "boolean",
	instructions: "x",
	criteria: { true: "t", false: "f" },
};

describe("validateQuestions", () => {
	test("valid set passes", () => {
		expect(() =>
			validateQuestions({
				b: bool,
				c: { type: "choice", instructions: "x", criteria: { a: "a", b: "b" } },
				s: { type: "score", instructions: "x", criteria: ["lo", "hi"] },
			}),
		).not.toThrow();
	});
	test("65 questions throws", () => {
		const qs: Record<string, Question> = {};
		for (let i = 0; i < 65; i++) qs[`q${i}`] = bool;
		expect(() => validateQuestions(qs)).toThrow(ClassifierInputError);
	});
	test("choice with 1 option throws", () => {
		expect(() =>
			validateQuestions({
				c: { type: "choice", instructions: "x", criteria: { a: "a" } },
			}),
		).toThrow(ClassifierInputError);
	});
	test("score with 11 levels throws", () => {
		expect(() =>
			validateQuestions({
				s: {
					type: "score",
					instructions: "x",
					criteria: Array.from({ length: 11 }, (_, i) => `l${i}`),
				},
			}),
		).toThrow(ClassifierInputError);
	});
	test("bad id throws", () => {
		expect(() => validateQuestions({ "bad id": bool })).toThrow(
			ClassifierInputError,
		);
	});
});

describe("stateSize", () => {
	test("string length and JSON length", () => {
		expect(stateSize("abcd")).toBe(4);
		expect(stateSize({ a: 1 })).toBe(JSON.stringify({ a: 1 }).length);
	});
});
