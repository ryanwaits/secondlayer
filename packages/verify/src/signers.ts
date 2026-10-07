// Signer threshold check: a Nakamoto header is canonical when signers holding
// >= 70% of the MARF-proven reward-cycle weight signed its signer_signature_hash.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { deserializeCV } from "@secondlayer/stacks/clarity";
import { c32address, hash160 } from "@secondlayer/stacks/utils";
import { type Bytes, hex } from "./bytes.ts";
import { type NakamotoHeader, signerSignatureHash } from "./header.ts";

/** Mainnet single-sig (p2pkh) address version. */
const MAINNET_P2PKH = 22;

/** Signer principal -> weight. */
export type SignerSet = Map<string, bigint>;

/**
 * Decode the `.signers` `cycle-signer-set` map value (hex or bytes, as stored
 * in the MARF): `(some (list (tuple (signer principal) (weight uint) ...)))`.
 */
export function decodeSignerSet(value: string | Bytes): SignerSet {
	const cv = deserializeCV(typeof value === "string" ? value : hex(value));
	if (cv.type !== "some" || cv.value.type !== "list")
		throw new Error("signer set must be (some (list ...))");
	const set: SignerSet = new Map();
	for (const entry of cv.value.value) {
		if (entry.type !== "tuple") throw new Error("signer entry must be a tuple");
		const { signer, weight } = entry.value;
		if (signer?.type !== "address" || weight?.type !== "uint")
			throw new Error("signer entry needs (signer principal) (weight uint)");
		if (set.has(signer.value))
			throw new Error(`duplicate signer ${signer.value}`);
		set.set(signer.value, BigInt(weight.value));
	}
	return set;
}

export interface SignerCheck {
	/** Signed weight meets the threshold, and every signature is a distinct known signer. */
	valid: boolean;
	signedWeight: bigint;
	totalWeight: bigint;
	/** ceil(total * 7 / 10). */
	threshold: bigint;
	/** Recovered signer principals that counted, in signature order. */
	signers: string[];
	/** Recovered principals not in the set. */
	unknown: string[];
	/** Principals that signed more than once. */
	duplicates: string[];
	/** Signatures that do not recover (malformed or high-S). */
	invalid: number;
}

/**
 * Recover each header signature's key over signer_signature_hash, map it to
 * its mainnet p2pkh principal, and sum weights from `set`. The set must be the
 * one for the reward cycle of the tenure-electing burn block.
 */
export function verifySignerSignatures(
	header: NakamotoHeader,
	set: SignerSet,
): SignerCheck {
	const msg = signerSignatureHash(header);
	let totalWeight = 0n;
	for (const w of set.values()) totalWeight += w;
	const threshold = (totalWeight * 7n + 9n) / 10n;
	const out: SignerCheck = {
		valid: false,
		signedWeight: 0n,
		totalWeight,
		threshold,
		signers: [],
		unknown: [],
		duplicates: [],
		invalid: 0,
	};
	const seen = new Set<string>();
	for (const sig of header.signerSignatures) {
		const who = recoverSigner(msg, sig);
		if (!who) out.invalid++;
		else if (seen.has(who)) out.duplicates.push(who);
		else {
			seen.add(who);
			const weight = set.get(who);
			if (weight === undefined) out.unknown.push(who);
			else {
				out.signers.push(who);
				out.signedWeight += weight;
			}
		}
	}
	out.valid =
		totalWeight > 0n &&
		out.signedWeight >= threshold &&
		out.unknown.length === 0 &&
		out.duplicates.length === 0 &&
		out.invalid === 0;
	return out;
}

/** Stacks recover_to_pubkey: VRS bytes, low-S enforced, compressed key -> p2pkh principal. */
function recoverSigner(msg: Bytes, sig: Bytes): string | null {
	try {
		const s = secp256k1.Signature.fromBytes(sig, "recovered");
		if (s.hasHighS()) return null;
		const pubkey = s.recoverPublicKey(msg).toBytes(true);
		return c32address(MAINNET_P2PKH, hex(hash160(pubkey)));
	} catch {
		return null;
	}
}
