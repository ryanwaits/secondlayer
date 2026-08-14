/**
 * Repair planner/executor — dry-run by default; mutation requires apply.
 * Only registered safe modes run. Unsafe ranges are refused.
 */

import type { RepairMode } from "./constraints.ts";
import type { CoverageRange } from "./constraints.ts";

export const SAFE_REPAIR_MODES: readonly RepairMode[] = [
	"range_safe",
	"full_reindex",
	"archive_replay",
];

export type RepairDefect =
	| "gap"
	| "digest_mismatch"
	| "omission"
	| "version"
	| "reorg"
	| "source_gap";

export type RepairPlan = {
	stage_id: string;
	range: CoverageRange;
	mode: RepairMode;
	defect: RepairDefect;
	safe: boolean;
	reason: string;
};

export function planRepair(input: {
	stage_id: string;
	range: CoverageRange;
	mode: RepairMode;
	defect: RepairDefect;
	range_safe_proven?: boolean;
}): RepairPlan {
	if (input.range.from_height > input.range.to_height) {
		return {
			...input,
			safe: false,
			reason: "inverted range",
		};
	}
	if (!(SAFE_REPAIR_MODES as readonly string[]).includes(input.mode)) {
		return {
			...input,
			safe: false,
			reason: `mode ${input.mode} is not registered`,
		};
	}
	if (input.mode === "range_safe" && !input.range_safe_proven) {
		return {
			...input,
			safe: false,
			reason: "range_safe requires a proven range",
		};
	}
	if (input.defect === "source_gap" && input.mode !== "archive_replay") {
		return {
			...input,
			safe: false,
			reason: "raw/source gaps require archive_replay",
		};
	}
	return {
		...input,
		safe: true,
		reason: `dry-run ${input.mode} for ${input.defect}`,
	};
}

export type RepairApplyResult =
	| { ok: true; applied: boolean; plan: RepairPlan }
	| { ok: false; reason: string; plan: RepairPlan };

export function applyRepair(
	plan: RepairPlan,
	opts?: { apply?: boolean },
): RepairApplyResult {
	if (!plan.safe) {
		return { ok: false, reason: plan.reason, plan };
	}
	if (!opts?.apply) {
		return { ok: true, applied: false, plan };
	}
	return { ok: true, applied: true, plan };
}
