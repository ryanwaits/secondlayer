// Burn height binding. A Nakamoto header carries no burn height, but its
// consensus_hash = RIPEMD160(SHA256(preimage)) and the preimage holds the
// burn block hash at a fixed offset (stacks-core burn/mod.rs):
//
//   [23,0,0,0] || burn_header_hash(32) || ops_hash(32) || total_burn(u64 BE) || pox_id || prev_CHs
//
// Any preimage hashing to the header's CH pins the burn block (forging one is a
// RIPEMD160∘SHA256 second preimage). Locate that hash in a PoW-verified
// Bitcoin header chain to get the height, then the reward cycle.
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { type Bytes, bytesEqual, hex } from "./bytes.ts";

const PREIMAGE_PREFIX = Uint8Array.of(23, 0, 0, 0);
const BHH_START = 4;
const BHH_END = 36;

/**
 * Check `preimage` against a 20-byte consensus hash. Returns the burn block
 * hash as hex, already in Bitcoin display order (as `bitcoin-cli
 * getblockhash` prints it), or null when the preimage does not match.
 */
export function verifyConsensusPreimage(
	consensusHash: Bytes,
	preimage: Bytes,
): string | null {
	if (consensusHash.length !== 20 || preimage.length < BHH_END) return null;
	if (!bytesEqual(preimage.subarray(0, BHH_START), PREIMAGE_PREFIX))
		return null;
	if (!bytesEqual(ripemd160(sha256(preimage)), consensusHash)) return null;
	return hex(preimage.subarray(BHH_START, BHH_END));
}

/** Mainnet PoX parameters (first_burnchain_block_height, reward_cycle_length). */
export const MAINNET_FIRST_BURN_HEIGHT = 666050;
export const MAINNET_REWARD_CYCLE_LENGTH = 2100;
/** Mainnet prepare phase: the last 100 burn blocks of a cycle pick the next cycle's signers. */
export const MAINNET_PREPARE_LENGTH = 100;

/** First burn height of reward cycle `cycle`. */
export const cycleStart = (
	cycle: number,
	firstBurnHeight = MAINNET_FIRST_BURN_HEIGHT,
	cycleLength = MAINNET_REWARD_CYCLE_LENGTH,
): number => firstBurnHeight + cycle * cycleLength;

/** Reward cycle containing `burnHeight`. */
export function rewardCycle(
	burnHeight: number,
	firstBurnHeight = MAINNET_FIRST_BURN_HEIGHT,
	cycleLength = MAINNET_REWARD_CYCLE_LENGTH,
): number {
	if (burnHeight < firstBurnHeight)
		throw new Error(`burn height ${burnHeight} precedes the first burn block`);
	return Math.floor((burnHeight - firstBurnHeight) / cycleLength);
}
