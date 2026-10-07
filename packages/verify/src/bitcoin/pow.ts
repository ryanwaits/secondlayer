/**
 * Proof-of-work arithmetic, mirroring Bitcoin Core's arith_uint256
 * SetCompact/GetCompact, CheckProofOfWork, GetBlockProof and
 * CalculateNextWorkRequired (mainnet parameters only).
 */

/** Mainnet powLimit, compact form. */
export const POW_LIMIT_BITS = 0x1d00ffff;
/** Mainnet powLimit: 0x00000000ffff0000...0000. */
export const POW_LIMIT = 0xffffn << 208n;
/** Blocks per difficulty period. */
export const RETARGET_INTERVAL = 2016;
/** Two weeks, seconds. */
export const TARGET_TIMESPAN = 14 * 24 * 60 * 60;

const TWO_256 = 1n << 256n;

export interface DecodedCompact {
	target: bigint;
	negative: boolean;
	overflow: boolean;
}

/** Core's arith_uint256::SetCompact, including its negative/overflow flags. */
export function decodeCompact(bits: number): DecodedCompact {
	const size = bits >>> 24;
	let word = bits & 0x007fffff;
	let target: bigint;
	if (size <= 3) {
		word >>>= 8 * (3 - size);
		target = BigInt(word);
	} else {
		target = BigInt(word) << BigInt(8 * (size - 3));
	}
	const negative = word !== 0 && (bits & 0x00800000) !== 0;
	const overflow =
		word !== 0 &&
		(size > 34 || (word > 0xff && size > 33) || (word > 0xffff && size > 32));
	return { target: target & (TWO_256 - 1n), negative, overflow };
}

/** Decodes compact bits to a target, throwing on negative/overflow/zero. */
export function bitsToTarget(bits: number): bigint {
	const { target, negative, overflow } = decodeCompact(bits);
	if (negative || overflow || target === 0n) {
		throw new RangeError(
			`bits 0x${bits.toString(16).padStart(8, "0")} do not encode a valid target`,
		);
	}
	return target;
}

/** Core's arith_uint256::GetCompact for a non-negative target. */
export function targetToBits(target: bigint): number {
	if (target < 0n) throw new RangeError("target must be non-negative");
	let size = target === 0n ? 0 : Math.ceil(target.toString(2).length / 8);
	let compact =
		size <= 3
			? Number(target << BigInt(8 * (3 - size)))
			: Number(target >> BigInt(8 * (size - 3)));
	if (compact & 0x00800000) {
		compact >>>= 8;
		size += 1;
	}
	return ((size << 24) | compact) >>> 0;
}

/** Interprets a natural-order hash as the little-endian 256-bit integer PoW compares. */
export function hashToBigInt(hash: Uint8Array): bigint {
	let n = 0n;
	for (let i = hash.length - 1; i >= 0; i--) {
		n = (n << 8n) | BigInt(hash[i] as number);
	}
	return n;
}

/** Core's CheckProofOfWork: valid target ≤ powLimit and hash ≤ target. */
export function checkProofOfWork(hash: Uint8Array, bits: number): boolean {
	const { target, negative, overflow } = decodeCompact(bits);
	if (negative || overflow || target === 0n || target > POW_LIMIT) {
		return false;
	}
	return hashToBigInt(hash) <= target;
}

/** Expected number of hashes for a block at `bits`: 2^256 / (target + 1). */
export function headerWork(bits: number): bigint {
	const target = bitsToTarget(bits);
	// Core's GetBlockProof: (~target / (target + 1)) + 1, same value without overflow.
	return (TWO_256 - 1n - target) / (target + 1n) + 1n;
}

/**
 * Core's CalculateNextWorkRequired. `firstTime` is the timestamp of the first
 * block of the closing period and `lastTime` of its last block, so the
 * measured span covers 2015 intervals, not 2016 (the well-known off-by-one
 * that consensus preserves).
 */
export function nextRetargetBits(
	lastBits: number,
	firstTime: number,
	lastTime: number,
): number {
	let actual = lastTime - firstTime;
	if (actual < TARGET_TIMESPAN / 4) actual = TARGET_TIMESPAN / 4;
	if (actual > TARGET_TIMESPAN * 4) actual = TARGET_TIMESPAN * 4;
	let target =
		(bitsToTarget(lastBits) * BigInt(actual)) / BigInt(TARGET_TIMESPAN);
	if (target > POW_LIMIT) target = POW_LIMIT;
	return targetToBits(target);
}
