/**
 * Segment sealer — compact only finalized receipts after recomputing
 * range digests. A crash or deep reorg must not leave a sealed green
 * range over unfinalized or invalidated receipts.
 */

import { createHash } from "node:crypto";
import type { CoverageRange } from "./constraints.ts";
import type { DecoderClockReceipt } from "./decoder-clock.ts";

export type SealableReceipt = {
	height: number;
	hash: string;
	input_digest: string;
	effect_digest: string;
	finalized: boolean;
};

export type SealedSegment = {
	from_height: number;
	to_height: number;
	chain_digest: string;
	input_digest: string;
	output_digest: string;
};

export type SealResult =
	| { ok: true; segment: SealedSegment; compacted: number }
	| { ok: false; reason: string };

export function rangeDigestOf(parts: readonly string[]): string {
	const hash = createHash("sha256");
	for (const part of parts) hash.update(`${part}\n`);
	return hash.digest("hex");
}

export function sealFinalizedRange(
	receipts: readonly SealableReceipt[],
	range: CoverageRange,
): SealResult {
	const inRange = receipts
		.filter((r) => r.height >= range.from_height && r.height <= range.to_height)
		.sort((a, b) => a.height - b.height);
	if (inRange.length === 0) {
		return { ok: false, reason: "no receipts in range" };
	}
	let expected = range.from_height;
	for (const receipt of inRange) {
		if (!receipt.finalized) {
			return { ok: false, reason: `unfinalized receipt at ${receipt.height}` };
		}
		if (receipt.height !== expected) {
			return {
				ok: false,
				reason: `gap at ${expected} before ${receipt.height}`,
			};
		}
		expected += 1;
	}
	if (inRange[inRange.length - 1]?.height !== range.to_height) {
		return { ok: false, reason: "range is not fully covered" };
	}
	return {
		ok: true,
		compacted: inRange.length,
		segment: {
			from_height: range.from_height,
			to_height: range.to_height,
			chain_digest: rangeDigestOf(inRange.map((r) => `${r.height}:${r.hash}`)),
			input_digest: rangeDigestOf(inRange.map((r) => r.input_digest)),
			output_digest: rangeDigestOf(inRange.map((r) => r.effect_digest)),
		},
	};
}

/** After a reorg at `fork`, any sealed segment that overlaps cannot stay green. */
export function segmentsSurviveReorg(
	segments: readonly SealedSegment[],
	fork: number,
): SealedSegment[] {
	return segments.filter((s) => s.to_height < fork);
}

export function receiptsAfterReorg(
	receipts: readonly SealableReceipt[],
	fork: number,
): SealableReceipt[] {
	return receipts.filter((r) => r.height < fork);
}

export type ClockReceipt = DecoderClockReceipt;
