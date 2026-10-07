import { describe, expect, test } from "bun:test";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
	hex,
	parseNakamotoHeader,
	rewardCycle,
	unhex,
	verifyConsensusPreimage,
} from "../src/index.ts";
import { type BurnFixture, headerFile, readJson } from "./fixtures.ts";

// Mainnet: sortition preimage behind Stacks block 9,137,005's consensus hash.
const fx = readJson<BurnFixture>("burn/preimage-970269.json");
const preimage = unhex(fx.preimage);
const ch = unhex(fx.consensus_hash);
/** Bitcoin block 970269 as `bitcoin-cli getblockhash 970269` prints it. */
const BLOCK_970269 =
	"00000000000000000001abf5e92c4e771c041ff3a9fde450c2291775641a801c";

describe("verifyConsensusPreimage", () => {
	test("mainnet preimage verifies and yields the burn block hash in display order", () => {
		expect(verifyConsensusPreimage(ch, preimage)).toBe(BLOCK_970269);
	});

	test("binds the parsed Stacks header's consensus hash to its burn block", () => {
		const h = parseNakamotoHeader(headerFile(fx.stacks_block));
		expect(hex(h.consensusHash)).toBe(fx.consensus_hash);
		expect(verifyConsensusPreimage(h.consensusHash, preimage)).toBe(
			BLOCK_970269,
		);
	});

	test("a flipped preimage byte fails", () => {
		const bad = preimage.slice();
		bad[10] = (bad[10] as number) ^ 1;
		expect(verifyConsensusPreimage(ch, bad)).toBeNull();
	});

	test("a wrong consensus hash fails", () => {
		const bad = ch.slice();
		bad[0] = (bad[0] as number) ^ 1;
		expect(verifyConsensusPreimage(bad, preimage)).toBeNull();
	});

	test("a wrong 4-byte prefix fails", () => {
		const bad = preimage.slice();
		bad[0] = 24;
		expect(verifyConsensusPreimage(ch, bad)).toBeNull();
	});

	test("synthetic: a preimage hashing to its CH but with the wrong prefix still fails", () => {
		// Synthetic, not mainnet data: CH computed over a bad-prefix preimage, so
		// only the prefix rule can reject it.
		const bad = preimage.slice();
		bad[1] = 1;
		const forgedCh = ripemd160(sha256(bad));
		expect(verifyConsensusPreimage(forgedCh, bad)).toBeNull();
	});

	test("short preimage fails", () => {
		expect(verifyConsensusPreimage(ch, preimage.subarray(0, 35))).toBeNull();
	});
});

describe("rewardCycle", () => {
	test("burn block 970269 is in mainnet reward cycle 144", () => {
		expect(rewardCycle(fx.burn_height)).toBe(fx.reward_cycle);
		expect(fx.reward_cycle).toBe(144);
	});

	test("cycle boundaries follow first height + n * length", () => {
		expect(rewardCycle(666050)).toBe(0);
		expect(rewardCycle(666050 + 2100 * 144 - 1)).toBe(143);
		expect(rewardCycle(666050 + 2100 * 144)).toBe(144);
		expect(rewardCycle(1000, 100, 10)).toBe(90);
	});

	test("heights before the first burn block are refused", () => {
		expect(() => rewardCycle(666049)).toThrow();
	});
});
