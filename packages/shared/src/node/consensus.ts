import { recoverPublicKey } from "@secondlayer/stacks/utils";

/**
 * Consensus verification: do ≥70% of a reward cycle's signer weight attest to a
 * Nakamoto block? Each header `signer_signature` is a recoverable ECDSA over the
 * block_hash; recover the pubkey, match it to the cycle's reward set, and sum the
 * matched signers' weights. Verified bit-exact against mainnet 3.4.0.0.3 (see
 * docs/design/trustless-verification-proofs.md, signer-signature appendix).
 */
const strip = (h: string): string => (h.startsWith("0x") ? h.slice(2) : h);

/** Mainnet PoX schedule (from /v2/pox) — overridable for other networks. */
export const MAINNET_FIRST_BURN_HEIGHT = 666_050;
export const MAINNET_REWARD_CYCLE_LENGTH = 2100;

export interface RewardSetSigner {
	/** 33-byte compressed secp256k1 public key (hex, no 0x). */
	signing_key: string;
	weight: number;
}

export interface RewardSet {
	signers: RewardSetSigner[];
	total_weight: number;
}

export interface SignerVerification {
	/** Summed weight of distinct reward-set signers that signed the block. */
	signedWeight: number;
	totalWeight: number;
	/** floor(total_weight * 7 / 10). */
	threshold: number;
	thresholdMet: boolean;
	/** Count of distinct reward-set keys that signed. */
	matchedSigners: number;
}

/** Reward cycle for a burn block height. Defaults to the mainnet PoX schedule. */
export function rewardCycle(
	burnBlockHeight: number,
	opts: { firstBurnHeight?: number; cycleLength?: number } = {},
): number {
	const first = opts.firstBurnHeight ?? MAINNET_FIRST_BURN_HEIGHT;
	const length = opts.cycleLength ?? MAINNET_REWARD_CYCLE_LENGTH;
	return Math.floor((burnBlockHeight - first) / length);
}

/** Recover the signer pubkey (compressed hex) from a 65-byte VRS recoverable
 *  ECDSA signature over the block_hash. */
export function recoverSignerKey(
	blockHashHex: string,
	vrsSignatureHex: string,
): string {
	return strip(
		recoverPublicKey(strip(blockHashHex), strip(vrsSignatureHex), true),
	);
}

/**
 * Recover each header signer signature, match it to the reward set, and sum the
 * distinct matched signers' weights against the 70% threshold. A signature that
 * fails to recover or whose key isn't in the set simply doesn't count — never
 * a false positive.
 */
export function verifySignerSignatures(
	blockHashHex: string,
	signerSignaturesHex: string[],
	rewardSet: RewardSet,
): SignerVerification {
	const byKey = new Map<string, number>(
		rewardSet.signers.map((s) => [strip(s.signing_key), s.weight]),
	);
	const seen = new Set<string>();
	let signedWeight = 0;
	let matchedSigners = 0;
	for (const sig of signerSignaturesHex) {
		let pubkey: string;
		try {
			pubkey = recoverSignerKey(blockHashHex, sig);
		} catch {
			continue; // malformed signature → no credit
		}
		const weight = byKey.get(pubkey);
		if (weight !== undefined && !seen.has(pubkey)) {
			seen.add(pubkey);
			signedWeight += weight;
			matchedSigners += 1;
		}
	}
	const threshold = Math.floor((rewardSet.total_weight * 7) / 10);
	return {
		signedWeight,
		totalWeight: rewardSet.total_weight,
		threshold,
		thresholdMet: signedWeight >= threshold,
		matchedSigners,
	};
}
