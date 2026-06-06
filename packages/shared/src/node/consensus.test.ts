import { describe, expect, test } from "bun:test";
import fixture from "./__fixtures__/nakamoto-block.json";
import {
	type RewardSet,
	recoverSignerKey,
	rewardCycle,
	verifySignerSignatures,
} from "./consensus.ts";
import { nakamotoBlockHash, parseNakamotoBlockHeader } from "./nakamoto.ts";

const raw = Uint8Array.from(Buffer.from(fixture.rawBlockHex, "hex"));
const header = parseNakamotoBlockHeader(raw);
const blockHash = nakamotoBlockHash(header);
const e = fixture.expect;
const rewardSet = fixture.rewardSet as RewardSet;

describe("consensus signer-signature verification", () => {
	test("reward cycle derives from the burn height", () => {
		expect(rewardCycle(e.burnBlockHeight)).toBe(e.rewardCycle);
	});

	test("every header signature recovers to a reward-set signer, ≥70% weight", () => {
		const v = verifySignerSignatures(
			blockHash,
			header.signerSignatures,
			rewardSet,
		);
		expect(v.matchedSigners).toBe(header.signerSignatures.length);
		expect(v.signedWeight).toBeGreaterThanOrEqual(v.threshold);
		expect(v.thresholdMet).toBe(true);
	});

	test("recovered keys are all members of the reward set", () => {
		const keys = new Set(rewardSet.signers.map((s) => s.signing_key));
		for (const sig of header.signerSignatures) {
			expect(keys.has(recoverSignerKey(blockHash, sig))).toBe(true);
		}
	});

	test("a wrong block hash recovers no in-set keys → threshold not met", () => {
		const v = verifySignerSignatures(
			"00".repeat(32),
			header.signerSignatures,
			rewardSet,
		);
		expect(v.matchedSigners).toBe(0);
		expect(v.thresholdMet).toBe(false);
	});

	test("a reward set the signers aren't in → threshold not met", () => {
		const empty: RewardSet = {
			signers: [],
			total_weight: rewardSet.total_weight,
		};
		expect(
			verifySignerSignatures(blockHash, header.signerSignatures, empty)
				.thresholdMet,
		).toBe(false);
	});
});
