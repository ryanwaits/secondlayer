import { describe, expect, it } from "bun:test";
import {
	type ScoredRow,
	formatComparison,
	scoreRow,
	summarizeProvider,
} from "./classifier-compare.ts";

const questions = {
	kind: { type: "choice", instructions: "x", criteria: { a: "a", b: "b" } },
	page: {
		type: "boolean",
		instructions: "x",
		criteria: { true: "t", false: "f" },
	},
	sev: { type: "score", instructions: "x", criteria: ["lo", "mid", "hi"] },
} as const;

describe("scoreRow", () => {
	it("scores each answer type against labels", () => {
		const s = scoreRow(
			questions,
			{ kind: "a", page: true, sev: 2 },
			{
				kind: {
					type: "choice",
					choice: "a",
					probabilities: { a: 0.9, b: 0.1 },
					confidence: 0.8,
				},
				page: { type: "boolean", probability: 0.4, confidence: 0.2 },
				sev: {
					type: "score",
					score: 1.7,
					probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 },
					confidence: 0.6,
				},
			},
		);
		expect(s.kind).toEqual({ correct: true, confidence: 0.8 });
		expect(s.page).toEqual({ correct: false, confidence: 0.2 });
		expect(s.sev).toEqual({ correct: true, confidence: 0.6 });
	});

	it("score without probabilities falls back to rounding", () => {
		const s = scoreRow(
			questions,
			{ sev: 2 },
			{
				sev: { type: "score", score: 1.6, probabilities: {}, confidence: 0 },
			},
		);
		expect(s.sev).toEqual({ correct: true, confidence: 0 });
	});

	it("refusal and missing label are null", () => {
		const s = scoreRow(
			questions,
			{ kind: "a" },
			{
				kind: { type: "refusal" },
				page: { type: "boolean", probability: 1, confidence: 1 },
			},
		);
		expect(s.kind).toEqual({ correct: null, confidence: null });
		expect(s.page).toEqual({ correct: null, confidence: null });
	});
});

describe("summarizeProvider", () => {
	const row = (correct: boolean, confidence: number): ScoredRow => ({
		kind: { correct, confidence },
	});
	const rows: ScoredRow[] = [
		row(true, 0.95),
		row(true, 0.75),
		row(false, 0.65),
		row(false, 0.1),
		null,
	];

	it("computes coverage and accuracy per threshold over covered rows", () => {
		const s = summarizeProvider(["kind"], rows).kind;
		expect(s?.n).toBe(4);
		expect(s?.failures).toBe(1);
		expect(s?.accuracy).toBeCloseTo(0.5);
		expect(s?.at["0.6"]).toEqual({ coverage: 0.75, accuracy: 2 / 3 });
		expect(s?.at["0.7"]).toEqual({ coverage: 0.5, accuracy: 1 });
		expect(s?.at["0.85"]).toEqual({ coverage: 0.25, accuracy: 1 });
		expect(s?.at["0.9"]).toEqual({ coverage: 0.25, accuracy: 1 });
	});
});

describe("formatComparison", () => {
	it("includes each provider name", () => {
		const out = formatComparison({
			jev: summarizeProvider(
				["kind"],
				[{ kind: { correct: true, confidence: 1 } }],
			),
			kev: summarizeProvider(["kind"], [null]),
		});
		expect(out).toContain("jev");
		expect(out).toContain("kev");
	});
});
