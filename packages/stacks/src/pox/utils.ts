import { parseBtcAddress as parseBtcAddressRepr } from "../pox5/btcAddress.ts";
import { MAX_LOCK_PERIOD, MIN_LOCK_PERIOD } from "./constants.ts";
import type { PoxAddress } from "./types.ts";

/**
 * Parse a Bitcoin address string into a frozen-pox `PoxAddress` tuple
 * (`buff 1` version, `buff 32` zero-padded hashbytes).
 * Supports P2PKH, P2SH, P2WPKH, P2WSH, P2TR (mainnet and testnet).
 *
 * Decoding lives in `pox5/btcAddress.ts`, which verifies the base58check
 * checksum on legacy addresses; this wrapper only pads to the pox-4 shape.
 */
export function parseBtcAddress(address: string): PoxAddress {
	const { version, hashbytes } = parseBtcAddressRepr(address);
	const padded = new Uint8Array(32);
	padded.set(hashbytes);
	return {
		version: new Uint8Array([version]),
		hashbytes: padded,
	};
}

/** Validate lock period is within allowed range (1-12). */
export function validateLockPeriod(periods: number): boolean {
	return (
		Number.isInteger(periods) &&
		periods >= MIN_LOCK_PERIOD &&
		periods <= MAX_LOCK_PERIOD
	);
}

/** Calculate the reward cycle for a given burn height. */
export function burnHeightToRewardCycle(
	burnHeight: bigint,
	firstBurnchainBlockHeight: bigint,
	rewardCycleLength: bigint,
): bigint {
	return (burnHeight - firstBurnchainBlockHeight) / rewardCycleLength;
}

/** Calculate the burn height at which a reward cycle starts. */
export function rewardCycleToBurnHeight(
	cycle: bigint,
	firstBurnchainBlockHeight: bigint,
	rewardCycleLength: bigint,
): bigint {
	return firstBurnchainBlockHeight + cycle * rewardCycleLength;
}
