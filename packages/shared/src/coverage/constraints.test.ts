import { describe, expect, test } from "bun:test";
import {
	type CoverageRange,
	FAILURE_CLASSES,
	FAILURE_UNITS,
	type FailureRow,
	NATIVE_CLOCKS,
	REPAIR_MODES,
	RETRY_STATES,
	RUN_STATUSES,
	type ReceiptRow,
	STAGE_KINDS,
	defaultRetainUntil,
	failureRangeHolds,
	failureRetentionHolds,
	isFailureClass,
	isFailureUnit,
	isNativeClock,
	isNonNegativeInt,
	isRepairMode,
	isRetryState,
	isRunStatus,
	isStageKind,
	rangeIsOrdered,
	receiptRetentionHolds,
	segmentsOverlap,
} from "./constraints.ts";

const SEED = 0xc0ffee;
const ITERATIONS = 256;

function mulberry32(seed: number): () => number {
	let t = seed >>> 0;
	return () => {
		t += 0x6d2b79f5;
		let r = Math.imul(t ^ (t >>> 15), 1 | t);
		r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}

function pick<T>(rand: () => number, items: readonly T[]): T {
	return items[Math.floor(rand() * items.length)] as T;
}

function intIn(rand: () => number, min: number, max: number): number {
	return min + Math.floor(rand() * (max - min + 1));
}

describe("coverage constraint membership", () => {
	test("every declared enum value is accepted", () => {
		for (const v of STAGE_KINDS) expect(isStageKind(v)).toBe(true);
		for (const v of NATIVE_CLOCKS) expect(isNativeClock(v)).toBe(true);
		for (const v of REPAIR_MODES) expect(isRepairMode(v)).toBe(true);
		for (const v of RUN_STATUSES) expect(isRunStatus(v)).toBe(true);
		for (const v of FAILURE_UNITS) expect(isFailureUnit(v)).toBe(true);
		for (const v of FAILURE_CLASSES) expect(isFailureClass(v)).toBe(true);
		for (const v of RETRY_STATES) expect(isRetryState(v)).toBe(true);
	});

	test("unknown tokens are rejected", () => {
		for (const junk of ["", "RAW", "block-clock", "ok", "retry"]) {
			expect(isStageKind(junk)).toBe(false);
			expect(isNativeClock(junk)).toBe(false);
			expect(isRepairMode(junk)).toBe(false);
			expect(isRunStatus(junk)).toBe(false);
			expect(isFailureUnit(junk)).toBe(false);
			expect(isFailureClass(junk)).toBe(false);
			expect(isRetryState(junk)).toBe(false);
		}
	});
});

describe("coverage range properties", () => {
	test("ordered ranges hold; inverted or negative do not", () => {
		const rand = mulberry32(SEED);
		for (let i = 0; i < ITERATIONS; i++) {
			const lo = intIn(rand, 0, 10_000);
			const span = intIn(rand, 0, 500);
			expect(rangeIsOrdered(lo, lo + span)).toBe(true);
			if (span > 0) expect(rangeIsOrdered(lo + span, lo)).toBe(false);
			expect(rangeIsOrdered(-1, lo)).toBe(false);
			expect(isNonNegativeInt(-1)).toBe(false);
		}
	});

	test("overlap is symmetric and reflexive", () => {
		const rand = mulberry32(SEED + 1);
		for (let i = 0; i < ITERATIONS; i++) {
			const a: CoverageRange = {
				from_height: intIn(rand, 0, 1_000),
				to_height: 0,
			};
			a.to_height = a.from_height + intIn(rand, 0, 200);
			const b: CoverageRange = {
				from_height: intIn(rand, 0, 1_000),
				to_height: 0,
			};
			b.to_height = b.from_height + intIn(rand, 0, 200);
			expect(segmentsOverlap(a, b)).toBe(segmentsOverlap(b, a));
			expect(segmentsOverlap(a, a)).toBe(true);
		}
	});

	test("disjoint adjacent ranges do not overlap", () => {
		expect(
			segmentsOverlap(
				{ from_height: 0, to_height: 9 },
				{ from_height: 10, to_height: 20 },
			),
		).toBe(false);
		expect(
			segmentsOverlap(
				{ from_height: 0, to_height: 10 },
				{ from_height: 10, to_height: 20 },
			),
		).toBe(true);
	});
});

describe("receipt retention", () => {
	test("compacted implies finalized, for random rows", () => {
		const rand = mulberry32(SEED + 2);
		for (let i = 0; i < ITERATIONS; i++) {
			const row: ReceiptRow = {
				block_height: intIn(rand, 0, 8_000_000),
				input_count: intIn(rand, 0, 400),
				finalized: rand() < 0.5,
				compacted_at: rand() < 0.5 ? new Date(intIn(rand, 1, 1e12)) : null,
			};
			const ok = receiptRetentionHolds(row);
			if (row.compacted_at !== null && !row.finalized) {
				expect(ok).toBe(false);
			} else {
				expect(ok).toBe(true);
			}
		}
	});

	test("negative height or input count fails", () => {
		expect(
			receiptRetentionHolds({
				block_height: -1,
				input_count: 0,
				finalized: true,
				compacted_at: null,
			}),
		).toBe(false);
		expect(
			receiptRetentionHolds({
				block_height: 0,
				input_count: -1,
				finalized: true,
				compacted_at: null,
			}),
		).toBe(false);
	});
});

describe("failure retention", () => {
	test("retain_until is never before created_at; resolved needs resolved_at", () => {
		const rand = mulberry32(SEED + 3);
		for (let i = 0; i < ITERATIONS; i++) {
			const created = new Date(
				intIn(rand, 1_700_000_000_000, 1_800_000_000_000),
			);
			const retainOk = rand() < 0.8;
			const retry_state = pick(rand, RETRY_STATES);
			const row: FailureRow = {
				from_height: rand() < 0.8 ? intIn(rand, 0, 1_000) : null,
				to_height: null,
				retry_state,
				retry_count: intIn(rand, 0, 8),
				resolved_at:
					retry_state === "resolved" && rand() < 0.7
						? new Date(created.getTime() + 1_000)
						: null,
				created_at: created,
				retain_until: retainOk
					? defaultRetainUntil(created)
					: new Date(created.getTime() - 1),
			};
			if (row.from_height !== null) {
				row.to_height = row.from_height + intIn(rand, 0, 50);
			}
			const holds = failureRangeHolds(row) && failureRetentionHolds(row);
			if (!retainOk) {
				expect(holds).toBe(false);
				continue;
			}
			if (retry_state === "resolved" && row.resolved_at === null) {
				expect(holds).toBe(false);
				continue;
			}
			expect(holds).toBe(true);
		}
	});

	test("inverted failure range is rejected", () => {
		const created = new Date("2026-08-13T00:00:00Z");
		expect(
			failureRangeHolds({
				from_height: 20,
				to_height: 10,
				retry_state: "open",
				retry_count: 0,
				resolved_at: null,
				created_at: created,
				retain_until: defaultRetainUntil(created),
			}),
		).toBe(false);
	});
});
