/**
 * Repair SAFETY GATE — decides whether a proposed repair is allowed to run.
 * Only registered safe modes pass; unsafe ranges and mode/defect mismatches are
 * refused.
 *
 * This file plans and refuses. It does not repair. The executor that actually
 * writes is `secondlayer repair --apply` (packages/cli/src/commands/repair.ts),
 * which rewrites blocks from a signed archive inside a transaction.
 *
 * There used to be an `applyRepair` here that returned `{applied: true}`
 * without touching anything. It was removed in 2026-08 rather than
 * implemented: a second executor would have been a fake one, and drills that
 * "recovered" through it would have proven nothing.
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
