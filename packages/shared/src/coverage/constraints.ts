/**
 * Coverage-kernel constraints. SQL CHECKs in migration 0116 must stay
 * identical — property tests treat this file as the spec.
 */

export const STAGE_KINDS = ["raw", "decode", "subgraph", "queue"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const NATIVE_CLOCKS = ["block", "cursor", "queue"] as const;
export type NativeClock = (typeof NATIVE_CLOCKS)[number];

export const REPAIR_MODES = [
	"range_safe",
	"full_reindex",
	"archive_replay",
	"none",
] as const;
export type RepairMode = (typeof REPAIR_MODES)[number];

export const RUN_STATUSES = [
	"pending",
	"running",
	"complete",
	"syncing",
	"lagging",
	"gap",
	"stale",
	"failed",
	"unverified_import",
	"unanchored",
	"source_unavailable",
	"out_of_scope",
	"disabled",
	"halted",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const FAILURE_UNITS = ["block", "range", "cursor", "queue"] as const;
export type FailureUnit = (typeof FAILURE_UNITS)[number];

export const FAILURE_CLASSES = [
	"omission",
	"version",
	"digest_mismatch",
	"crash",
	"reorg",
	"source_gap",
	"handler",
	"timeout",
	"unknown",
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

export const RETRY_STATES = ["open", "retrying", "halted", "resolved"] as const;
export type RetryState = (typeof RETRY_STATES)[number];

/** Default failure retention after `created_at`. */
export const FAILURE_RETENTION_DAYS = 30;

export type CoverageRange = {
	from_height: number;
	to_height: number;
};

export type ReceiptRow = {
	block_height: number;
	input_count: number;
	finalized: boolean;
	compacted_at: Date | null;
};

export type FailureRow = {
	from_height: number | null;
	to_height: number | null;
	retry_state: RetryState;
	retry_count: number;
	resolved_at: Date | null;
	created_at: Date;
	retain_until: Date;
};

function isMember<T extends string>(
	set: readonly T[],
	value: string,
): value is T {
	return (set as readonly string[]).includes(value);
}

export function isStageKind(value: string): value is StageKind {
	return isMember(STAGE_KINDS, value);
}

export function isNativeClock(value: string): value is NativeClock {
	return isMember(NATIVE_CLOCKS, value);
}

export function isRepairMode(value: string): value is RepairMode {
	return isMember(REPAIR_MODES, value);
}

export function isRunStatus(value: string): value is RunStatus {
	return isMember(RUN_STATUSES, value);
}

export function isFailureUnit(value: string): value is FailureUnit {
	return isMember(FAILURE_UNITS, value);
}

export function isFailureClass(value: string): value is FailureClass {
	return isMember(FAILURE_CLASSES, value);
}

export function isRetryState(value: string): value is RetryState {
	return isMember(RETRY_STATES, value);
}

export function isNonNegativeInt(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0;
}

export function rangeIsOrdered(from: number, to: number): boolean {
	return isNonNegativeInt(from) && isNonNegativeInt(to) && from <= to;
}

/** Compacted receipts must already be finalized. */
export function receiptRetentionHolds(row: ReceiptRow): boolean {
	if (!isNonNegativeInt(row.block_height)) return false;
	if (!isNonNegativeInt(row.input_count)) return false;
	if (row.compacted_at !== null && !row.finalized) return false;
	return true;
}

export function failureRangeHolds(row: FailureRow): boolean {
	if (row.from_height !== null && !isNonNegativeInt(row.from_height)) {
		return false;
	}
	if (row.to_height !== null && !isNonNegativeInt(row.to_height)) {
		return false;
	}
	if (
		row.from_height !== null &&
		row.to_height !== null &&
		row.from_height > row.to_height
	) {
		return false;
	}
	return true;
}

/** Resolved rows need `resolved_at`; open rows keep `retain_until` ≥ created. */
export function failureRetentionHolds(row: FailureRow): boolean {
	if (!isNonNegativeInt(row.retry_count)) return false;
	if (row.retain_until.getTime() < row.created_at.getTime()) return false;
	if (row.retry_state === "resolved") return row.resolved_at !== null;
	return true;
}

/** Two closed ranges on the same stage must not overlap. */
export function segmentsOverlap(a: CoverageRange, b: CoverageRange): boolean {
	return a.from_height <= b.to_height && b.from_height <= a.to_height;
}

export function defaultRetainUntil(createdAt: Date): Date {
	return new Date(
		createdAt.getTime() + FAILURE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
	);
}
