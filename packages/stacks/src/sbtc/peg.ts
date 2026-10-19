import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bech32m } from "@scure/base";
import { HDKey } from "@scure/bip32";
import {
	BITCOIN_NETWORK_PARAMS,
	taprootTweakPubkey,
} from "../bitcoin/address.ts";
import type { BitcoinNetwork } from "../bitcoin/constants.ts";
import { BaseError } from "../errors/base.ts";
import { bytesToHex, concatBytes, hexToBytes } from "../utils/encoding.ts";

/**
 * Bitcoin height at which mainnet sBTC signers start locking the peg UTXO to
 * the v2 script (`MAINNET_V2_SIGNING_BLOCK_HEIGHT` in the sBTC signer). From
 * this height the next sweep pays the v2 output; until that sweep confirms,
 * the peg funds still sit at the v1 address.
 */
export const SBTC_V2_SIGNING_BURN_HEIGHT_MAINNET = 972_295;

/** Most signer keys a v2 peg script may hold (`sbtc::MAX_SIGNERS`). */
const MAX_SIGNERS = 16;

/**
 * Unspendable internal key of v2 peg outputs: the `/0/0` child of the
 * BIP341 NUMS point with an all-zero chain code (`V2_NUMS_X_COORDINATE`).
 */
export const SBTC_V2_INTERNAL_KEY: Uint8Array = hexToBytes(
	"4a30b2e461b280c0b13a03799096ab1256589153fc4b9c8cead16dc0b6420697",
);

const CHAIN_CODE_DOMAIN = new TextEncoder().encode("sbtc/signer/chain-code/v1");

const OP_CHECKSIG = 0xac;
const OP_CHECKSIGADD = 0xba;
const OP_NUMEQUAL = 0x9c;
const OP_PUSHNUM_BASE = 0x50; // OP_1 = 0x51 … OP_16 = 0x60
const TAPSCRIPT_LEAF_VERSION = 0xc0;

/**
 * The registry's aggregate-key field holds the v2 marker `0xFF || block hash`
 * instead of a public key. There is no aggregate key to derive an address
 * from: the v2 peg is derived from the signer set and threshold.
 */
export class SbtcV2MarkerError extends BaseError {
	override name = "SbtcV2MarkerError";
}

/**
 * Check a registry aggregate key and return it. A key is 33 bytes starting
 * with `0x02`/`0x03`. Throws {@link SbtcV2MarkerError} on the v2 marker
 * (`0xFF` prefix) and a plain `Error` on anything else.
 */
export function assertRegistryAggregateKey(key: Uint8Array): Uint8Array {
	if (key.length === 33 && key[0] === 0xff) {
		throw new SbtcV2MarkerError(
			"sbtc-registry aggregate key is the v2 marker (0xFF || block hash), not a public key",
			{
				details:
					"Derive the v2 peg from the signer set: getSignersAddress(client, { version: 'v2' }).",
			},
		);
	}
	if (key.length !== 33 || (key[0] !== 0x02 && key[0] !== 0x03)) {
		throw new Error(
			`sbtc-registry aggregate key is not a compressed public key (${key.length} bytes, prefix 0x${(key[0] ?? 0).toString(16).padStart(2, "0")})`,
		);
	}
	return key;
}

/**
 * The x-only Bitcoin signing key of one registry signer: the unhardened
 * `/0/0` BIP32 child of its 33-byte public key, with chain code
 * `SHA256("sbtc/signer/chain-code/v1" || pubkey)`.
 */
export function deriveSbtcSigningKey(
	registryPublicKey: Uint8Array,
): Uint8Array {
	if (
		registryPublicKey.length !== 33 ||
		(registryPublicKey[0] !== 0x02 && registryPublicKey[0] !== 0x03)
	) {
		throw new Error("sBTC signer key must be a 33-byte compressed public key");
	}
	const master = new HDKey({
		publicKey: registryPublicKey,
		chainCode: sha256(concatBytes(CHAIN_CODE_DOMAIN, registryPublicKey)),
	});
	const child = master.deriveChild(0).deriveChild(0).publicKey;
	if (!child) throw new Error("BIP32 derivation returned no public key");
	return child.slice(1);
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
	for (let i = 0; i < a.length; i++) {
		const d = (a[i] as number) - (b[i] as number);
		if (d !== 0) return d;
	}
	return a.length - b.length;
}

function compactSize(n: number): Uint8Array {
	if (n < 0xfd) return Uint8Array.of(n);
	if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >> 8);
	throw new Error("tapscript too long");
}

/** A v2 sBTC peg output: the `multi_a` leaf, its scriptPubKey and address. */
export interface SbtcV2PegOutput {
	/** Sorted x-only signing keys in the script. */
	signingKeys: Uint8Array[];
	signaturesRequired: number;
	/** `<k1> CHECKSIG <k2> CHECKSIGADD … <m> NUMEQUAL`. */
	signingScript: Uint8Array;
	/** `OP_1 <32-byte output key>`. */
	scriptPubKey: Uint8Array;
	address: string;
}

/**
 * Derive the v2 peg output from the registry signer set and threshold:
 * `tr(NUMS_V2, multi_a(m, signer_1/0/0, …))` with the derived keys x-only and
 * sorted. Mirrors `SignerKeySet::derive` + `script_pubkey` in the sBTC signer.
 */
export function deriveSbtcV2PegOutput(
	signerPublicKeys: readonly Uint8Array[],
	signaturesRequired: number,
	network: BitcoinNetwork = "mainnet",
): SbtcV2PegOutput {
	const unique = new Map<string, Uint8Array>();
	for (const key of signerPublicKeys.map(deriveSbtcSigningKey)) {
		unique.set(bytesToHex(key), key);
	}
	const signingKeys = [...unique.values()].sort(compareBytes);
	if (signingKeys.length > MAX_SIGNERS) {
		throw new Error(
			`sBTC v2 peg holds at most ${MAX_SIGNERS} signer keys, got ${signingKeys.length}`,
		);
	}
	if (
		!Number.isInteger(signaturesRequired) ||
		signaturesRequired < 1 ||
		signaturesRequired > signingKeys.length
	) {
		throw new Error(
			`sBTC v2 threshold must be between 1 and ${signingKeys.length}, got ${signaturesRequired}`,
		);
	}

	const signingScript = concatBytes(
		...signingKeys.map((key, i) =>
			concatBytes(
				Uint8Array.of(0x20),
				key,
				Uint8Array.of(i === 0 ? OP_CHECKSIG : OP_CHECKSIGADD),
			),
		),
		Uint8Array.of(OP_PUSHNUM_BASE + signaturesRequired, OP_NUMEQUAL),
	);
	const leafHash = schnorr.utils.taggedHash(
		"TapLeaf",
		Uint8Array.of(TAPSCRIPT_LEAF_VERSION),
		compactSize(signingScript.length),
		signingScript,
	);
	const outputKey = taprootTweakPubkey(SBTC_V2_INTERNAL_KEY, leafHash);
	return {
		signingKeys,
		signaturesRequired,
		signingScript,
		scriptPubKey: concatBytes(Uint8Array.of(0x51, 0x20), outputKey),
		address: bech32m.encode(BITCOIN_NETWORK_PARAMS[network].hrp, [
			1,
			...bech32m.toWords(outputKey),
		]),
	};
}
