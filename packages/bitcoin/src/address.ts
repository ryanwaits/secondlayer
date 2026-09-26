// Mainnet address derivation from a scriptPubKey, for the five standard
// output types Runes actually land on (P2PKH, P2SH, P2WPKH, P2WSH, P2TR).
// This is not general UTXO/address indexing (PRODUCT.md line 64 excludes
// that) — it only labels rune-bearing outputs so a balance/event can carry
// "whose" address as derived data. Not a port of any ord file; ord doesn't
// expose this (it stores/serves scripts, not addresses). Own base58check and
// bech32/bech32m encoders (D18: npm deps only, no @secondlayer/* imports);
// `@noble/hashes` (already a dependency) supplies sha256 for the base58check
// checksum. Algorithms: base58check per Bitcoin's Base58Check encoding,
// bech32/bech32m per BIP-173 / BIP-350.

import { sha256 } from "@noble/hashes/sha2.js";

function doubleSha256(data: Uint8Array): Uint8Array {
	return sha256(sha256(data));
}

const BASE58_ALPHABET =
	"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 (not Base58Check — no version byte, no checksum) — Bitcoin's alphabet, leading zero bytes become leading '1's. */
export function base58Encode(bytes: Uint8Array): string {
	let zeros = 0;
	while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;

	// Big-endian bytes -> big integer, then repeated divmod 58 (same approach
	// as every reference Base58 implementation; bigint keeps this exact for
	// arbitrarily long inputs, unlike a Number-based divmod).
	let n = 0n;
	for (const b of bytes) n = (n << 8n) | BigInt(b);

	let digits = "";
	while (n > 0n) {
		const rem = n % 58n;
		n /= 58n;
		digits = BASE58_ALPHABET[Number(rem)] + digits;
	}

	return "1".repeat(zeros) + digits;
}

/** Base58Check: `base58(version ‖ payload ‖ sha256(sha256(version ‖ payload))[0:4])`. */
export function base58CheckEncode(
	version: number,
	payload: Uint8Array,
): string {
	const versioned = new Uint8Array(1 + payload.length);
	versioned[0] = version;
	versioned.set(payload, 1);
	const checksum = doubleSha256(versioned).slice(0, 4);
	const full = new Uint8Array(versioned.length + 4);
	full.set(versioned, 0);
	full.set(checksum, versioned.length);
	return base58Encode(full);
}

const P2PKH_VERSION_MAINNET = 0x00;
const P2SH_VERSION_MAINNET = 0x05;

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
/** BIP-173 checksum constant, used for witness version 0. */
const BECH32_CONST = 1;
/** BIP-350 checksum constant, used for witness version 1+ (bech32m). */
const BECH32M_CONST = 0x2bc830a3;
const BECH32_GENERATOR = [
	0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3,
];

function bech32Polymod(values: number[]): number {
	let chk = 1;
	for (const v of values) {
		const b = chk >>> 25;
		chk = ((chk & 0x1ffffff) << 5) ^ v;
		for (let i = 0; i < 5; i++) {
			if ((b >>> i) & 1) chk ^= BECH32_GENERATOR[i] as number;
		}
	}
	return chk >>> 0;
}

function bech32HrpExpand(hrp: string): number[] {
	const out: number[] = [];
	for (const c of hrp) out.push(c.charCodeAt(0) >>> 5);
	out.push(0);
	for (const c of hrp) out.push(c.charCodeAt(0) & 31);
	return out;
}

function bech32CreateChecksum(
	hrp: string,
	data: number[],
	constant: number,
): number[] {
	const values = [...bech32HrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
	const mod = bech32Polymod(values) ^ constant;
	const checksum: number[] = [];
	for (let p = 0; p < 6; p++) {
		checksum.push((mod >>> (5 * (5 - p))) & 31);
	}
	return checksum;
}

function bech32Encode(hrp: string, data: number[], constant: number): string {
	const checksum = bech32CreateChecksum(hrp, data, constant);
	const combined = [...data, ...checksum];
	return `${hrp}1${combined.map((d) => BECH32_CHARSET[d]).join("")}`;
}

/** Regroups `data` from `fromBits`-wide values into `toBits`-wide values (BIP-173's `convertbits`). Returns `undefined` on an invalid/non-zero-padded remainder. */
export function convertBits(
	data: Uint8Array,
	fromBits: number,
	toBits: number,
	pad: boolean,
): number[] | undefined {
	let acc = 0;
	let bits = 0;
	const ret: number[] = [];
	const maxv = (1 << toBits) - 1;
	const maxAcc = (1 << (fromBits + toBits - 1)) - 1;
	for (const value of data) {
		if (value >>> fromBits !== 0) return undefined;
		acc = ((acc << fromBits) | value) & maxAcc;
		bits += fromBits;
		while (bits >= toBits) {
			bits -= toBits;
			ret.push((acc >>> bits) & maxv);
		}
	}
	if (pad) {
		if (bits > 0) ret.push((acc << (toBits - bits)) & maxv);
	} else if (bits >= fromBits || (acc << (toBits - bits)) & maxv) {
		return undefined;
	}
	return ret;
}

/** BIP-173/350 segwit address encoding: `hrp` + witness version + program, bech32 for v0, bech32m for v1+. */
export function segwitAddressEncode(
	hrp: string,
	witnessVersion: number,
	witnessProgram: Uint8Array,
): string {
	const words = convertBits(witnessProgram, 8, 5, true);
	if (!words) throw new Error("segwitAddressEncode: invalid witness program");
	const data = [witnessVersion, ...words];
	const constant = witnessVersion === 0 ? BECH32_CONST : BECH32M_CONST;
	return bech32Encode(hrp, data, constant);
}

const MAINNET_HRP = "bc";

const OP_DUP = 0x76;
const OP_HASH160 = 0xa9;
const OP_EQUALVERIFY = 0x88;
const OP_CHECKSIG = 0xac;
const OP_EQUAL = 0x87;
const OP_0 = 0x00;
const OP_1 = 0x51;
const PUSH_20 = 0x14;
const PUSH_32 = 0x20;

/**
 * Mainnet address for a scriptPubKey, for the five standard output types
 * (P2PKH, P2SH, P2WPKH, P2WSH, P2TR). Any other script (bare multisig,
 * OP_RETURN, an unassigned witness version, non-standard) returns
 * `undefined` — this is not a general script-to-address decoder, only the
 * shapes a rune-bearing output can plausibly carry.
 */
export function addressFromScript(script: Uint8Array): string | undefined {
	// P2PKH: OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG
	if (
		script.length === 25 &&
		script[0] === OP_DUP &&
		script[1] === OP_HASH160 &&
		script[2] === PUSH_20 &&
		script[23] === OP_EQUALVERIFY &&
		script[24] === OP_CHECKSIG
	) {
		return base58CheckEncode(P2PKH_VERSION_MAINNET, script.subarray(3, 23));
	}

	// P2SH: OP_HASH160 <20> OP_EQUAL
	if (
		script.length === 23 &&
		script[0] === OP_HASH160 &&
		script[1] === PUSH_20 &&
		script[22] === OP_EQUAL
	) {
		return base58CheckEncode(P2SH_VERSION_MAINNET, script.subarray(2, 22));
	}

	// P2WPKH: OP_0 <20>
	if (script.length === 22 && script[0] === OP_0 && script[1] === PUSH_20) {
		return segwitAddressEncode(MAINNET_HRP, 0, script.subarray(2, 22));
	}

	// P2WSH: OP_0 <32>
	if (script.length === 34 && script[0] === OP_0 && script[1] === PUSH_32) {
		return segwitAddressEncode(MAINNET_HRP, 0, script.subarray(2, 34));
	}

	// P2TR: OP_1 <32>
	if (script.length === 34 && script[0] === OP_1 && script[1] === PUSH_32) {
		return segwitAddressEncode(MAINNET_HRP, 1, script.subarray(2, 34));
	}

	return undefined;
}
