import { describe, expect, test } from "bun:test";
import {
	receiptsAfterReorg,
	sealFinalizedRange,
	segmentsSurviveReorg,
} from "./sealer.ts";

function rec(height: number, opts?: { finalized?: boolean; hash?: string }) {
	return {
		height,
		hash: opts?.hash ?? `0x${height}`,
		input_digest: `i${height}`,
		effect_digest: `e${height}`,
		finalized: opts?.finalized ?? true,
	};
}

describe("segment sealer", () => {
	test("seals a contiguous finalized range and recomputes digests", () => {
		const result = sealFinalizedRange([rec(10), rec(11), rec(12)], {
			from_height: 10,
			to_height: 12,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.compacted).toBe(3);
			expect(result.segment.chain_digest).toHaveLength(64);
			expect(result.segment.input_digest).not.toBe(
				result.segment.output_digest,
			);
		}
	});

	test("refuses an unfinalized receipt — crash cannot stay green", () => {
		const result = sealFinalizedRange(
			[rec(10), rec(11, { finalized: false }), rec(12)],
			{ from_height: 10, to_height: 12 },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain("unfinalized");
	});

	test("a deep reorg drops overlapping sealed segments and receipts", () => {
		const sealed = sealFinalizedRange([rec(10), rec(11), rec(12)], {
			from_height: 10,
			to_height: 12,
		});
		if (!sealed.ok) throw new Error(sealed.reason);
		expect(segmentsSurviveReorg([sealed.segment], 11)).toEqual([]);
		expect(segmentsSurviveReorg([sealed.segment], 13)).toHaveLength(1);
		expect(
			receiptsAfterReorg([rec(10), rec(11), rec(12)], 11).map((r) => r.height),
		).toEqual([10]);
	});

	test("a hole in the range refuses to seal", () => {
		expect(
			sealFinalizedRange([rec(10), rec(12)], {
				from_height: 10,
				to_height: 12,
			}).ok,
		).toBe(false);
	});
});
