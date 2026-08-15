import { describe, expect, test } from "bun:test";
import { planRepair } from "./repair.ts";

/**
 * These cover the gate only. The executor lives in the CLI
 * (`secondlayer repair --apply`) and is exercised end to end there — this file
 * previously also asserted an `applyRepair` that returned success without
 * writing anything, which proved only that a constant is a constant.
 */
describe("repair safety gate", () => {
	test("a registered mode with a matching defect is allowed", () => {
		const plan = planRepair({
			stage_id: "raw",
			range: { from_height: 1, to_height: 10 },
			mode: "archive_replay",
			defect: "source_gap",
		});
		expect(plan.safe).toBe(true);
		expect(plan.reason).toContain("archive_replay");
	});

	test("refuses an unproven range_safe mode", () => {
		// `range_safe` claims a range needs no rework; without proof that claim
		// would silently skip repairing real damage.
		const plan = planRepair({
			stage_id: "subgraph:x",
			range: { from_height: 1, to_height: 2 },
			mode: "range_safe",
			defect: "gap",
		});
		expect(plan.safe).toBe(false);
		expect(plan.reason).toContain("proven");
	});

	test("refuses an inverted range", () => {
		const plan = planRepair({
			stage_id: "raw",
			range: { from_height: 10, to_height: 1 },
			mode: "full_reindex",
			defect: "gap",
		});
		expect(plan.safe).toBe(false);
	});

	test("refuses an unregistered mode", () => {
		const plan = planRepair({
			stage_id: "raw",
			range: { from_height: 1, to_height: 2 },
			// Deliberately outside SAFE_REPAIR_MODES.
			mode: "unsafe_mode" as never,
			defect: "gap",
		});
		expect(plan.safe).toBe(false);
		expect(plan.reason).toContain("not registered");
	});

	test("a source gap may only be repaired from the archive", () => {
		// Reindexing cannot invent history the instance never had; only a
		// replay from the signed archive can.
		const reindex = planRepair({
			stage_id: "raw",
			range: { from_height: 1, to_height: 2 },
			mode: "full_reindex",
			defect: "source_gap",
		});
		expect(reindex.safe).toBe(false);
		expect(reindex.reason).toContain("archive_replay");
	});

	test("each supported defect has a mode that passes the gate", () => {
		const cases = [
			{ defect: "gap" as const, mode: "full_reindex" as const },
			{ defect: "digest_mismatch" as const, mode: "full_reindex" as const },
			{ defect: "omission" as const, mode: "full_reindex" as const },
			{ defect: "version" as const, mode: "full_reindex" as const },
			{ defect: "reorg" as const, mode: "full_reindex" as const },
			{ defect: "source_gap" as const, mode: "archive_replay" as const },
		];
		for (const c of cases) {
			const plan = planRepair({
				stage_id: "decode:ft_transfer",
				range: { from_height: 0, to_height: 1 },
				mode: c.mode,
				defect: c.defect,
			});
			expect(plan.safe).toBe(true);
		}
	});
});
