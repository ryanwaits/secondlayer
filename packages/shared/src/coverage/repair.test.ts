import { describe, expect, test } from "bun:test";
import { applyRepair, planRepair } from "./repair.ts";

describe("repair planner", () => {
	test("defaults to a dry-run and mutates only with apply", () => {
		const plan = planRepair({
			stage_id: "raw",
			range: { from_height: 1, to_height: 10 },
			mode: "archive_replay",
			defect: "source_gap",
		});
		expect(plan.safe).toBe(true);
		const dry = applyRepair(plan);
		expect(dry.ok).toBe(true);
		expect(dry.ok && dry.applied).toBe(false);
		const applied = applyRepair(plan, { apply: true });
		expect(applied.ok && applied.applied).toBe(true);
	});

	test("refuses an unproven range_safe mode", () => {
		const plan = planRepair({
			stage_id: "subgraph:x",
			range: { from_height: 1, to_height: 2 },
			mode: "range_safe",
			defect: "gap",
		});
		expect(plan.safe).toBe(false);
		expect(applyRepair(plan, { apply: true }).ok).toBe(false);
	});

	test("each supported defect has a safe mode that returns green", () => {
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
			const result = applyRepair(plan, { apply: true });
			expect(result.ok).toBe(true);
		}
	});
});
