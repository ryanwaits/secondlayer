import { describe, expect, it } from "bun:test";
import {
	FAULT_TAXONOMY,
	buildTriageState,
	formatReport,
	summarize,
	triageQuestions,
	verdictFor,
} from "./jev-fault-triage.ts";
import type { FaultRow } from "./jev-fault-triage.ts";

const row: FaultRow = {
	stage_id: "decode.generic.v1",
	class: "version",
	retry_state: "open",
	retry_count: 2,
	last_error: "unsupported schema version 99 for event ft_event",
	from_height: 100,
	to_height: 100,
	created_at: "2026-09-17T00:00:00Z",
};

describe("buildTriageState", () => {
	it("never leaks the recorded class into the state", () => {
		const state = buildTriageState(row);
		expect(JSON.stringify(state)).not.toContain('"version"');
		expect(state).toMatchObject({
			component: "decode.generic.v1",
			block_range: { from: 100, to: 100 },
			retries_so_far: 2,
		});
	});

	it("truncates very long error strings", () => {
		const long = buildTriageState({
			...row,
			last_error: "x".repeat(10_000),
		});
		expect((long.error as string).length).toBe(4000);
	});
});

describe("triageQuestions", () => {
	it("covers the full stage_failures class taxonomy", () => {
		const q = triageQuestions();
		expect(Object.keys(q.fault_class.criteria).sort()).toEqual(
			[
				"crash",
				"digest_mismatch",
				"handler",
				"omission",
				"reorg",
				"source_gap",
				"timeout",
				"unknown",
				"version",
			].sort(),
		);
		expect(Object.keys(FAULT_TAXONOMY)).toHaveLength(9);
	});
});

describe("verdictFor", () => {
	it("agrees when jev matches the recorded class", () => {
		const v = verdictFor({
			row,
			regexClass: "version",
			jevClass: "version",
			jevProbabilities: { version: 0.9 },
			jevConfidence: 0.9,
			transientProbability: 0.1,
			severity: 2,
		});
		expect(v.agreement).toBe("agree");
	});

	it("flags regex_match when jev sides with the regex over the record", () => {
		const v = verdictFor({
			row, // recorded "version"
			regexClass: "version",
			jevClass: "omission",
			jevProbabilities: null,
			jevConfidence: null,
			transientProbability: null,
			severity: null,
		});
		expect(v.agreement).toBe("disagree");
		const v2 = verdictFor({
			row: { ...row, class: "omission" },
			regexClass: "version",
			jevClass: "version",
			jevProbabilities: null,
			jevConfidence: null,
			transientProbability: null,
			severity: null,
		});
		expect(v2.agreement).toBe("regex_match");
	});

	it("skips when the model call failed", () => {
		const v = verdictFor({
			row,
			regexClass: null,
			jevClass: null,
			jevProbabilities: null,
			jevConfidence: null,
			transientProbability: null,
			severity: null,
		});
		expect(v.agreement).toBe("skipped");
	});
});

describe("summarize", () => {
	it("computes rates over evaluated rows only", () => {
		const mk = (agreement: "agree" | "disagree" | "skipped") =>
			verdictFor({
				row,
				regexClass: null,
				jevClass:
					agreement === "skipped"
						? null
						: agreement === "agree"
							? row.class
							: "unknown",
				jevProbabilities: null,
				jevConfidence: 0.9,
				transientProbability: 0.2,
				severity: 3,
			});
		const s = summarize({
			verdicts: [mk("agree"), mk("agree"), mk("disagree"), mk("skipped")],
			warnings: [],
		});
		expect(s.evaluated).toBe(3);
		expect(s.agreement_rate).toBeCloseTo(2 / 3);
		expect(s.would_page).toBe(3);
		expect(s.low_confidence).toBe(0);
	});

	it("returns null rate with no evaluated rows", () => {
		const s = summarize({ verdicts: [], warnings: [] });
		expect(s.agreement_rate).toBeNull();
		expect(s.mean_severity).toBeNull();
	});
});

describe("formatReport", () => {
	it("renders a summary and lists non-agree rows", () => {
		const s = summarize({
			verdicts: [
				verdictFor({
					row,
					regexClass: "version",
					jevClass: "omission",
					jevProbabilities: null,
					jevConfidence: 0.4,
					transientProbability: 0.9,
					severity: 1.5,
				}),
			],
			warnings: ["test warning"],
		});
		const out = formatReport(s);
		expect(out).toContain("disagree");
		expect(out).toContain("decode.generic.v1");
		expect(out).toContain("test warning");
	});
});
