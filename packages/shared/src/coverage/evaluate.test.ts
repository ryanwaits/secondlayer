import { describe, expect, test } from "bun:test";
import snapshot from "../../test/__snapshots__/coverage-evaluate.json";
import { CASES, stage } from "./evaluate.fixtures.ts";
import type { CoverageState } from "./evaluate.ts";
import {
	contiguousThrough,
	evaluateCoverage,
	findRangeGaps,
	mergeRanges,
	topoSort,
} from "./evaluate.ts";

/**
 * Fixture matrix P4.2 asks for: one result per required state, plus
 * dependency capping, cursor/queue clocks, and a cycle.
 *
 * If this fails, regenerate only after confirming the change is real:
 *   bun packages/shared/src/coverage/write-evaluate-snapshot.ts
 */

function stateOf(name: keyof typeof CASES): CoverageState {
	const report = evaluateCoverage(CASES[name]);
	const row = report.stages[0];
	if (!row) throw new Error(`no stages in ${name}`);
	return row.state;
}

describe("range helpers", () => {
	test("merges overlapping and adjacent ranges", () => {
		expect(
			mergeRanges([
				{ from_height: 10, to_height: 20 },
				{ from_height: 21, to_height: 30 },
				{ from_height: 5, to_height: 12 },
			]),
		).toEqual([{ from_height: 5, to_height: 30 }]);
	});

	test("contiguousThrough stops at the first hole", () => {
		expect(
			contiguousThrough(
				[
					{ from_height: 0, to_height: 10 },
					{ from_height: 12, to_height: 20 },
				],
				0,
			),
		).toBe(10);
	});

	test("findRangeGaps names the holes inside the declared range", () => {
		expect(
			findRangeGaps(
				[
					{ from_height: 0, to_height: 10 },
					{ from_height: 20, to_height: 30 },
				],
				0,
				30,
			),
		).toEqual([{ from_height: 11, to_height: 19 }]);
	});
});

describe("dependency order", () => {
	test("parents evaluate before children", () => {
		const { order, cycles } = topoSort([
			stage({ id: "decode:stx", depends_on: "raw", kind: "decode" }),
			stage({ id: "raw" }),
		]);
		expect(order).toEqual(["raw", "decode:stx"]);
		expect(cycles).toEqual([]);
	});

	test("a cycle is reported, not silently dropped", () => {
		const { order, cycles } = topoSort([
			stage({ id: "a", depends_on: "b" }),
			stage({ id: "b", depends_on: "a" }),
		]);
		expect(order).toEqual([]);
		expect(cycles).toEqual([["a", "b"]]);
	});
});

describe("required states", () => {
	test("complete through the recorded target, current finalized", () => {
		expect(stateOf("complete")).toBe("complete");
		const row = evaluateCoverage(CASES.complete).stages[0];
		expect(row?.caught_up).toBe(true);
		expect(row?.complete_through).toBe(100);
		expect(row?.source_tip).toBe(100);
	});

	test("through finalized, behind tip is lagging", () => {
		expect(stateOf("lagging")).toBe("lagging");
		const row = evaluateCoverage(CASES.lagging).stages[0];
		expect(row?.caught_up).toBe(true);
		expect(row?.complete_through).toBe(100);
		expect(row?.source_tip).toBe(140);
	});

	test("far behind finalized is stale", () => {
		expect(stateOf("stale")).toBe("stale");
	});

	test("an old source observation is stale even when heights match", () => {
		expect(stateOf("stale-clock")).toBe("stale");
	});

	test("a hole in the declared range is gap", () => {
		expect(stateOf("gap")).toBe("gap");
		expect(evaluateCoverage(CASES.gap).stages[0]?.gaps).toEqual([
			{ from_height: 41, to_height: 79 },
		]);
	});

	test("contiguous prefix short of the target is syncing", () => {
		expect(stateOf("syncing")).toBe("syncing");
		expect(evaluateCoverage(CASES.syncing).stages[0]?.complete_through).toBe(
			40,
		);
	});

	test("an open failure is failed", () => {
		expect(stateOf("failed")).toBe("failed");
	});

	test("imported unaudited data is unverified_import", () => {
		expect(stateOf("unverified_import")).toBe("unverified_import");
	});

	test("missing hashes are unanchored", () => {
		expect(stateOf("unanchored")).toBe("unanchored");
	});

	test("no source and no recorded target is source_unavailable", () => {
		expect(stateOf("source_unavailable")).toBe("source_unavailable");
	});

	test("target below start is out_of_scope", () => {
		expect(stateOf("out_of_scope")).toBe("out_of_scope");
	});

	test("disabled stays disabled", () => {
		expect(stateOf("disabled")).toBe("disabled");
	});
});

describe("clocks and dependencies", () => {
	test("a child cannot run ahead of its parent", () => {
		const report = evaluateCoverage(CASES["dep-cap"]);
		const raw = report.stages.find((s) => s.stage_id === "raw");
		const decode = report.stages.find((s) => s.stage_id === "decode:stx");
		expect(raw?.state).toBe("syncing");
		expect(raw?.complete_through).toBe(50);
		expect(decode?.complete_through).toBe(50);
		expect(decode?.state).toBe("syncing");
	});

	test("cursor clock tiles 0..height", () => {
		expect(stateOf("cursor-complete")).toBe("complete");
		expect(
			evaluateCoverage(CASES["cursor-complete"]).stages[0]?.complete_through,
		).toBe(100);
	});

	test("queue is syncing until accepted equals delivered+dead", () => {
		expect(stateOf("queue-syncing")).toBe("syncing");
		expect(stateOf("queue-complete")).toBe("complete");
	});

	test("cycles fail both members", () => {
		const report = evaluateCoverage(CASES.cycle);
		expect(report.cycles).toEqual([["a", "b"]]);
		expect(report.stages.every((s) => s.state === "failed")).toBe(true);
	});

	test("unknown depends_on is failed", () => {
		expect(stateOf("missing-dep")).toBe("failed");
	});

	test("complete through target is not caught_up when finalized is further", () => {
		const row = evaluateCoverage(CASES["complete-not-caught-up"]).stages[0];
		expect(row?.state).toBe("complete");
		expect(row?.caught_up).toBe(false);
		expect(row?.complete_through).toBe(100);
		expect(row?.source_tip).toBe(200);
	});
});

describe("result snapshots", () => {
	test("every fixture report matches the checked-in snapshot", () => {
		const reports: Record<string, ReturnType<typeof evaluateCoverage>> = {};
		for (const [name, fixture] of Object.entries(CASES)) {
			reports[name] = evaluateCoverage(fixture);
		}
		expect(JSON.parse(JSON.stringify(reports))).toEqual(snapshot);
	});
});
