import { describe, expect, test } from "bun:test";
import { hashEffectManifest } from "./effect-manifest.ts";
import { proofsAgree, sequentialDigests, sparseDigests } from "./sparse.ts";

describe("sparse proofs", () => {
	test("sparse skips and sequential empty handlers agree", () => {
		const empty = hashEffectManifest([]);
		const executed = [
			{
				height: 10,
				hash: "0xa",
				effect_digest: hashEffectManifest([
					{ op: "insert", table: "t", key: { id: 1 } },
				]),
				row_digest: "r10",
			},
			{ height: 12, hash: "0xc", effect_digest: empty, row_digest: "r12" },
		];
		const sequential = sequentialDigests([
			executed[0],
			{
				height: 11,
				hash: "0xb",
				effect_digest: empty,
				row_digest: empty,
			},
			executed[1],
		]);
		const sparse = sparseDigests(executed, [
			{
				skip: { from_height: 11, to_height: 11, reason: "no-match" },
				hash: "0xb",
			},
		]);
		expect(proofsAgree(sequential, sparse)).toBe(true);
	});
});
