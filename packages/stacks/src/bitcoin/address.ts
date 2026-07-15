import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { base58, bech32, bech32m } from "@scure/base";
import { concatBytes, hexToBytes } from "../utils/encoding.ts";
import { hash160 } from "../utils/hash.ts";
import type { ParsedOutputScript } from "./codec.ts";
import type { BitcoinNetwork } from "./constants.ts";
import { doubleSha256 } from "./serialize.ts";

/** Address-encoding parameters (base58 version bytes + bech32 hrp) per network. */
export const BITCOIN_NETWORK_PARAMS = {
	mainnet: { p2pkh: 0x00, p2sh: 0x05, hrp: "bc" },
	testnet: { p2pkh: 0x6f, p2sh: 0xc4, hrp: "tb" },
	regtest: { p2pkh: 0x6f, p2sh: 0xc4, hrp: "bcrt" },
} as const;

const NETWORK_PARAMS = BITCOIN_NETWORK_PARAMS;

/** Base58Check-encode a versioned 20-byte payload (legacy P2PKH / P2SH). */
function base58Check(version: number, payload: Uint8Array): string {
	const data = concatBytes(Uint8Array.of(version), payload);
	const checksum = doubleSha256(data).slice(0, 4);
	return base58.encode(concatBytes(data, checksum));
}

/**
 * Render a parsed output script as a Bitcoin address for the given network.
 * Returns `undefined` for scripts without a standard address (OP_RETURN, P2PK,
 * unknown). Address encoding is network-dependent, which is why this is separate
 * from the pure `parseOutputScript` decoder.
 */
export function formatBitcoinAddress(
	parsed: ParsedOutputScript,
	network: BitcoinNetwork = "mainnet",
): string | undefined {
	const params = NETWORK_PARAMS[network];
	const hash = parsed.hash;
	if (!hash) return undefined;
	switch (parsed.type) {
		case "p2pkh":
			return base58Check(params.p2pkh, hash);
		case "p2sh":
			return base58Check(params.p2sh, hash);
		case "p2wpkh":
		case "p2wsh":
			return bech32.encode(params.hrp, [0, ...bech32.toWords(hash)]);
		case "p2tr":
			return bech32m.encode(params.hrp, [1, ...bech32m.toWords(hash)]);
		default:
			return undefined;
	}
}

function toPubkeyBytes(publicKey: Uint8Array | string): Uint8Array {
	return typeof publicKey === "string" ? hexToBytes(publicKey) : publicKey;
}

/**
 * BIP341 key-path tweak: lift the x-only internal key to a point, add
 * `tapTweakHash(P)·G` (no script tree), and return the x-only output key.
 */
export function taprootTweakPubkey(xonly: Uint8Array): Uint8Array {
	if (xonly.length !== 32)
		throw new Error(`Expected 32-byte x-only pubkey, got ${xonly.length}`);
	const tweak = schnorr.utils.taggedHash("TapTweak", xonly);
	const t = BigInt(
		`0x${Array.from(tweak, (b) => b.toString(16).padStart(2, "0")).join("")}`,
	);
	if (t >= secp256k1.Point.Fn.ORDER)
		throw new Error("Invalid tap tweak (exceeds curve order)");
	const internal = secp256k1.Point.fromBytes(
		concatBytes(Uint8Array.of(0x02), xonly),
	);
	const output = internal.add(secp256k1.Point.BASE.multiply(t));
	return output.toBytes(true).slice(1);
}

/**
 * Derive the native-segwit (P2WPKH, bech32 v0) address for a compressed
 * public key.
 */
export function publicKeyToP2wpkhAddress(
	publicKey: Uint8Array | string,
	network: BitcoinNetwork = "mainnet",
): string {
	const pubkey = toPubkeyBytes(publicKey);
	if (pubkey.length !== 33)
		throw new Error(`Expected 33-byte compressed pubkey, got ${pubkey.length}`);
	const params = NETWORK_PARAMS[network];
	return bech32.encode(params.hrp, [0, ...bech32.toWords(hash160(pubkey))]);
}

/**
 * Derive the taproot (P2TR, bech32m v1) address for a public key — BIP341
 * key-path spend, no script tree. Accepts a 33-byte compressed key (the
 * parity byte is dropped) or a 32-byte x-only key.
 */
export function publicKeyToP2trAddress(
	publicKey: Uint8Array | string,
	network: BitcoinNetwork = "mainnet",
): string {
	const pubkey = toPubkeyBytes(publicKey);
	const xonly =
		pubkey.length === 33
			? pubkey.slice(1)
			: pubkey.length === 32
				? pubkey
				: undefined;
	if (!xonly)
		throw new Error(
			`Expected 33-byte compressed or 32-byte x-only pubkey, got ${pubkey.length}`,
		);
	const params = NETWORK_PARAMS[network];
	const outputKey = taprootTweakPubkey(xonly);
	return bech32m.encode(params.hrp, [1, ...bech32m.toWords(outputKey)]);
}
