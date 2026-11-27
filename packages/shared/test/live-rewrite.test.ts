import { describe, expect, test } from "bun:test";
import {
	type LiveRewriteFacts,
	contiguousRuns,
	diffDigests,
	isLiveRewriteReady,
	nextIndexName,
	rewriteIndexDef,
} from "../src/db/live-rewrite.ts";

const READY_FACTS: LiveRewriteFacts = {
	nextExists: true,
	triggerCount: 3,
	copiedBelow: 1_001,
	liveMaxHeight: 1_000,
	missingIndexes: [],
	invalidIndexes: [],
	missingConstraints: [],
	unvalidatedConstraints: [],
	verifiedAt: new Date("2026-11-27T12:00:00Z"),
	copiedAt: new Date("2026-11-27T11:00:00Z"),
	pendingDirtyHeights: 0,
};

describe("isLiveRewriteReady", () => {
	test("accepts a copied, indexed, verified rewrite", () => {
		expect(isLiveRewriteReady(READY_FACTS)).toEqual({
			ready: true,
			reasons: [],
		});
	});

	const failures: [string, Partial<LiveRewriteFacts>, RegExp][] = [
		["a missing next table", { nextExists: false }, /next table/],
		["missing triggers", { triggerCount: 2 }, /triggers missing \(2\/3\)/],
		[
			"a copy that has not reached the live tip",
			{ copiedBelow: 1_000 },
			/copy incomplete/,
		],
		["a missing index", { missingIndexes: ["a_idx_next"] }, /a_idx_next/],
		["an invalid index", { invalidIndexes: ["b_idx_next"] }, /b_idx_next/],
		[
			"a missing foreign key",
			{ missingConstraints: ["fk_next"] },
			/constraints missing: fk_next/,
		],
		[
			"an unvalidated foreign key",
			{ unvalidatedConstraints: ["fk_next"] },
			/not validated/,
		],
		["no verification", { verifiedAt: null }, /verify has not passed/],
		[
			"a verification older than the last copy window",
			{ verifiedAt: new Date("2026-11-27T10:00:00Z") },
			/older than the last copy/,
		],
		[
			"a dirty-height backlog over the limit",
			{ pendingDirtyHeights: 10_001 },
			/10001 dirty heights/,
		],
	];
	for (const [label, patch, message] of failures) {
		test(`rejects ${label}`, () => {
			const verdict = isLiveRewriteReady({ ...READY_FACTS, ...patch });
			expect(verdict.ready).toBe(false);
			expect(verdict.reasons).toHaveLength(1);
			expect(verdict.reasons[0]).toMatch(message);
		});
	}

	test("accepts a backlog of exactly the limit", () => {
		expect(
			isLiveRewriteReady({ ...READY_FACTS, pendingDirtyHeights: 10_000 }).ready,
		).toBe(true);
	});

	test("ignores the copy and backlog reasons the swap resolves itself", () => {
		const verdict = isLiveRewriteReady(
			{ ...READY_FACTS, copiedBelow: 10, pendingDirtyHeights: 50_000 },
			{ ignore: ["copy_incomplete", "dirty_backlog"] },
		);
		expect(verdict.ready).toBe(true);
	});

	test("lists every failing reason together", () => {
		const verdict = isLiveRewriteReady({
			...READY_FACTS,
			nextExists: false,
			verifiedAt: null,
		});
		expect(verdict.reasons).toHaveLength(2);
	});
});

describe("rewriteIndexDef", () => {
	test("points a plain index at the next table with a suffixed name", () => {
		expect(
			rewriteIndexDef(
				"CREATE INDEX vm_events_type_height_ordinal_idx ON public.vm_events USING btree (type, block_height, ordinal)",
				"vm_events",
				"vm_events_type_height_ordinal_idx",
			),
		).toBe(
			"CREATE INDEX vm_events_type_height_ordinal_idx_next ON public.vm_events_next USING btree (type, block_height, ordinal)",
		);
	});

	test("keeps a partial index predicate", () => {
		expect(
			rewriteIndexDef(
				"CREATE UNIQUE INDEX t_live_idx ON public.t USING btree (block_height) WHERE (type = 'a'::text)",
				"t",
				"t_live_idx",
			),
		).toBe(
			"CREATE UNIQUE INDEX t_live_idx_next ON public.t_next USING btree (block_height) WHERE (type = 'a'::text)",
		);
	});

	test("keeps an expression index body", () => {
		expect(
			rewriteIndexDef(
				"CREATE INDEX vm_events_contract_type_height_idx ON public.vm_events USING btree (((data ->> 'contract_identifier'::text)), type, block_height, ordinal)",
				"vm_events",
				"vm_events_contract_type_height_idx",
			),
		).toBe(
			"CREATE INDEX vm_events_contract_type_height_idx_next ON public.vm_events_next USING btree (((data ->> 'contract_identifier'::text)), type, block_height, ordinal)",
		);
	});

	test("refuses a definition for another index", () => {
		expect(() =>
			rewriteIndexDef(
				"CREATE INDEX other_idx ON public.t USING btree (a)",
				"t",
				"t_idx",
			),
		).toThrow(/unrecognized index definition/);
	});
});

describe("identifier length", () => {
	test("refuses an index name whose suffixed form passes 63 characters", () => {
		expect(() => nextIndexName("x".repeat(59))).toThrow(/over the 63 limit/);
	});

	test("refuses a name whose retired form passes 63 characters", () => {
		expect(() => nextIndexName("x".repeat(60))).toThrow(/over the 63 limit/);
	});

	test("accepts the longest name that fits both suffixes", () => {
		expect(nextIndexName("x".repeat(58))).toBe(`${"x".repeat(58)}_next`);
	});
});

describe("contiguousRuns", () => {
	test("merges adjacent heights and splits gaps", () => {
		expect(contiguousRuns([5, 3, 4, 9, 3])).toEqual([
			{ from: 3, to: 6 },
			{ from: 9, to: 10 },
		]);
	});
});

describe("diffDigests", () => {
	const row = (block_height: number, n: number, md5: string) => ({
		block_height,
		n,
		md5,
	});

	test("reports heights whose count or hash differ or exist on one side", () => {
		expect(
			diffDigests(
				[row(1, 2, "a"), row(2, 2, "b"), row(3, 1, "c"), row(5, 1, "e")],
				[row(1, 2, "a"), row(2, 2, "x"), row(3, 2, "c"), row(4, 1, "d")],
			),
		).toEqual([2, 3, 4, 5]);
	});

	test("reports nothing when both sides match", () => {
		expect(diffDigests([row(1, 1, "a")], [row(1, 1, "a")])).toEqual([]);
	});
});
