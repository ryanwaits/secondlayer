/**
 * Sparse proofs — acknowledge skipped canonical ranges without handler
 * execution. Sparse and sequential paths must agree on chain / effect /
 * final-row digests.
 */

import { createHash } from "node:crypto";
import type { CoverageRange } from "./constraints.ts";
import { type EffectMutation, hashEffectManifest } from "./effect-manifest.ts";
import { rangeDigestOf } from "./sealer.ts";

export type SparseSkip = CoverageRange & { reason: "no-match" | "filtered" };

export type HeightDigest = {
	height: number;
	hash: string;
	effect_digest: string;
	row_digest: string;
};

export function skipReceipt(skip: SparseSkip, chainHash: string): HeightDigest {
	const empty = hashEffectManifest([]);
	return {
		height: skip.from_height,
		hash: chainHash,
		effect_digest: empty,
		row_digest: empty,
	};
}

export function sequentialDigests(heights: readonly HeightDigest[]): {
	chain: string;
	effect: string;
	row: string;
} {
	const ordered = [...heights].sort((a, b) => a.height - b.height);
	return {
		chain: rangeDigestOf(ordered.map((h) => `${h.height}:${h.hash}`)),
		effect: rangeDigestOf(ordered.map((h) => h.effect_digest)),
		row: rangeDigestOf(ordered.map((h) => h.row_digest)),
	};
}

export function sparseDigests(
	executed: readonly HeightDigest[],
	skips: readonly { skip: SparseSkip; hash: string }[],
): { chain: string; effect: string; row: string } {
	const skipped = skips.flatMap(({ skip, hash }) => {
		const out: HeightDigest[] = [];
		for (let h = skip.from_height; h <= skip.to_height; h++) {
			out.push(skipReceipt({ ...skip, from_height: h, to_height: h }, hash));
		}
		return out;
	});
	return sequentialDigests([...executed, ...skipped]);
}

export function proofsAgree(
	sequential: { chain: string; effect: string; row: string },
	sparse: { chain: string; effect: string; row: string },
): boolean {
	return (
		sequential.chain === sparse.chain &&
		sequential.effect === sparse.effect &&
		sequential.row === sparse.row
	);
}

export function emptyRowDigest(): string {
	return createHash("sha256").update("empty-row\n").digest("hex");
}

export type { EffectMutation };
