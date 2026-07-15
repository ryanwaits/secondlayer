import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { LocalAccount } from "../accounts/types.ts";
import { serializeCVBytes } from "../clarity/serialize.ts";
import { Cl } from "../clarity/values.ts";
import { bytesToHex, concatBytes, hexToBytes } from "../utils/encoding.ts";
import { POX5_SIGNER_DOMAIN } from "./constants.ts";

/**
 * PoX-5 signer-key grants: SIP-018 structured-data signatures authorizing a
 * signer-manager contract to use a signer key. Mirrors
 * `pox-5.get-signer-grant-message-hash` — domain `pox-5-signer/1.0.0`,
 * message `{ topic: "grant-authorization", signer-manager, auth-id }`.
 */
export type SignerGrantOptions = {
	/** The signer-manager contract principal being authorized. */
	signerManager: string;
	/** Replay-protection id, chosen by the signer. */
	authId: bigint | number;
	/** Stacks chain id (`mainnet.id` / `testnet.id`). */
	chainId: number;
};

const SIP018_PREFIX = hexToBytes("534950303138"); // "SIP018"

/**
 * The 32-byte hash a signer signs to grant their key — byte-identical to the
 * contract's `get-signer-grant-message-hash` read-only (which doubles as an
 * on-chain cross-check).
 */
export function computeSignerGrantHash(opts: SignerGrantOptions): Uint8Array {
	const domain = serializeCVBytes(
		Cl.tuple({
			name: Cl.stringAscii(POX5_SIGNER_DOMAIN.name),
			version: Cl.stringAscii(POX5_SIGNER_DOMAIN.version),
			"chain-id": Cl.uint(opts.chainId),
		}),
	);
	const message = serializeCVBytes(
		Cl.tuple({
			topic: Cl.stringAscii("grant-authorization"),
			"signer-manager": Cl.principal(opts.signerManager),
			"auth-id": Cl.uint(opts.authId),
		}),
	);
	return sha256(concatBytes(SIP018_PREFIX, sha256(domain), sha256(message)));
}

/**
 * Sign a signer-key grant. Returns the 65-byte recoverable signature in RSV
 * order (recovery byte last), hex — the layout `grant-signer-key`'s
 * `signer-sig (buff 65)` expects.
 */
export async function signSignerGrant(
	account: LocalAccount,
	opts: SignerGrantOptions,
): Promise<string> {
	const vrs = await account.sign(computeSignerGrantHash(opts));
	if (vrs.length !== 65)
		throw new Error(
			`Expected 65-byte recoverable signature, got ${vrs.length}`,
		);
	// account.sign returns VRS; the contract wants RSV.
	return bytesToHex(concatBytes(vrs.slice(1), vrs.slice(0, 1)));
}

/**
 * Verify a signer-key grant signature locally: recover the pubkey from the
 * RSV signature over the grant hash and compare. Returns `false` for
 * malformed input rather than throwing.
 */
export function verifySignerGrant(
	opts: SignerGrantOptions & {
		publicKey: Uint8Array | string;
		signature: Uint8Array | string;
	},
): boolean {
	try {
		const sig =
			typeof opts.signature === "string"
				? hexToBytes(opts.signature)
				: opts.signature;
		if (sig.length !== 65) return false;
		const pubkey =
			typeof opts.publicKey === "string"
				? hexToBytes(opts.publicKey)
				: opts.publicKey;
		const hash = computeSignerGrantHash(opts);
		const recovered = secp256k1.Signature.fromBytes(sig.slice(0, 64))
			.addRecoveryBit(sig[64] as number)
			.recoverPublicKey(hash)
			.toBytes(true);
		return bytesToHex(recovered) === bytesToHex(pubkey);
	} catch {
		return false;
	}
}
