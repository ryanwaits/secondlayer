import { base58, bech32, bech32m } from "@scure/base";
import { BITCOIN_NETWORK_PARAMS } from "../bitcoin/address.ts";
import type { BitcoinNetwork } from "../bitcoin/constants.ts";
import { doubleSha256 } from "../bitcoin/serialize.ts";
import { POX_ADDRESS_VERSION } from "../pox/constants.ts";
import { concatBytes, hexToBytes } from "../utils/encoding.ts";

/**
 * SIP-005 PoX `pox-addr` tuple, decoded from a Bitcoin address. `version` is
 * the PoX byte (`POX_ADDRESS_VERSION`), not a Bitcoin network version
 * (`p2sh` is 0x01 here, 0x05 on mainnet Bitcoin). `hashbytes` is the 20- or
 * 32-byte payload — unpadded, matching `check-pox-addr-hashbytes`.
 */
export type BtcAddressRepr = {
	version: number;
	hashbytes: Uint8Array;
};

const BASE58_ALPHABET =
	"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(str: string): Uint8Array {
	let num = 0n;
	for (const char of str) {
		const idx = BASE58_ALPHABET.indexOf(char);
		if (idx === -1) throw new Error(`Invalid base58 character: ${char}`);
		num = num * 58n + BigInt(idx);
	}

	const hex = num.toString(16).padStart(2, "0");
	const padded = hex.length % 2 ? `0${hex}` : hex;
	const rawBytes = hexToBytes(padded);

	let leadingZeros = 0;
	for (const char of str) {
		if (char === "1") leadingZeros++;
		else break;
	}

	const result = new Uint8Array(leadingZeros + rawBytes.length);
	result.set(rawBytes, leadingZeros);
	return result;
}

function base58CheckEncode(version: number, payload: Uint8Array): string {
	const data = concatBytes(Uint8Array.of(version), payload);
	const checksum = doubleSha256(data).slice(0, 4);
	return base58.encode(concatBytes(data, checksum));
}

function expectedHashLen(version: number): number {
	if (!Number.isInteger(version) || version < 0x00 || version > 0x06) {
		throw new Error(`Unknown PoX address version: 0x${version.toString(16)}`);
	}
	return version <= 0x04 ? 20 : 32;
}

/** Strip frozen-pox 32-byte padding; reject a length that doesn't match the version. */
export function canonicalizeBtcAddress(repr: BtcAddressRepr): BtcAddressRepr {
	const expected = expectedHashLen(repr.version);
	const { hashbytes } = repr;
	if (hashbytes.length === expected)
		return { version: repr.version, hashbytes };
	if (
		expected === 20 &&
		hashbytes.length === 32 &&
		hashbytes.slice(20).every((b) => b === 0)
	) {
		return { version: repr.version, hashbytes: hashbytes.slice(0, 20) };
	}
	throw new Error(
		`Invalid hashbytes length for PoX version 0x${repr.version.toString(16)}: ${hashbytes.length}`,
	);
}

/**
 * Parse a Bitcoin address string into a PoX address tuple.
 * Supports P2PKH, P2SH, P2WPKH, P2WSH, P2TR (mainnet, testnet, regtest).
 */
export function parseBtcAddress(address: string): BtcAddressRepr {
	if (
		address.startsWith("bc1") ||
		address.startsWith("tb1") ||
		address.startsWith("bcrt1")
	) {
		return parseSegwitAddress(address);
	}
	return parseLegacyAddress(address);
}

function parseSegwitAddress(address: string): BtcAddressRepr {
	let decoded: { prefix: string; words: number[] };
	try {
		decoded = bech32.decode(address as `${string}1${string}`);
	} catch {
		decoded = bech32m.decode(address as `${string}1${string}`);
	}

	const witnessVersion = decoded.words[0];
	if (witnessVersion === undefined) {
		throw new Error("Invalid segwit address: missing witness version");
	}
	const data = bech32.fromWords(decoded.words.slice(1));
	const hashbytes = new Uint8Array(data);

	let version: number;
	if (witnessVersion === 0) {
		if (hashbytes.length === 20) {
			version = POX_ADDRESS_VERSION.p2wpkh;
		} else if (hashbytes.length === 32) {
			version = POX_ADDRESS_VERSION.p2wsh;
		} else {
			throw new Error(`Invalid witness v0 program length: ${hashbytes.length}`);
		}
	} else if (witnessVersion === 1) {
		if (hashbytes.length !== 32) {
			throw new Error(`Invalid witness v1 program length: ${hashbytes.length}`);
		}
		version = POX_ADDRESS_VERSION.p2tr;
	} else {
		throw new Error(`Unsupported witness version: ${witnessVersion}`);
	}

	return { version, hashbytes };
}

function parseLegacyAddress(address: string): BtcAddressRepr {
	const decoded = base58Decode(address);

	if (decoded.length !== 25) {
		throw new Error(`Invalid legacy address length: ${decoded.length}`);
	}

	const versionByte = decoded[0];
	if (versionByte === undefined) {
		throw new Error("Invalid legacy address: missing version byte");
	}
	const hashbytes = decoded.slice(1, 21);

	let version: number;
	if (versionByte === 0x00 || versionByte === 0x6f) {
		version = POX_ADDRESS_VERSION.p2pkh;
	} else if (versionByte === 0x05 || versionByte === 0xc4) {
		version = POX_ADDRESS_VERSION.p2sh;
	} else {
		throw new Error(
			`Unknown legacy address version byte: 0x${versionByte.toString(16)}`,
		);
	}

	return { version, hashbytes };
}

export function stringifyBtcAddress(
	repr: BtcAddressRepr,
	network: BitcoinNetwork,
): string {
	const { version, hashbytes } = canonicalizeBtcAddress(repr);
	const params = BITCOIN_NETWORK_PARAMS[network];
	switch (version) {
		case POX_ADDRESS_VERSION.p2pkh:
			return base58CheckEncode(params.p2pkh, hashbytes);
		case POX_ADDRESS_VERSION.p2sh:
		case POX_ADDRESS_VERSION.p2sh_p2wpkh:
		case POX_ADDRESS_VERSION.p2sh_p2wsh:
			return base58CheckEncode(params.p2sh, hashbytes);
		case POX_ADDRESS_VERSION.p2wpkh:
		case POX_ADDRESS_VERSION.p2wsh:
			return bech32.encode(params.hrp, [0, ...bech32.toWords(hashbytes)]);
		case POX_ADDRESS_VERSION.p2tr:
			return bech32m.encode(params.hrp, [1, ...bech32m.toWords(hashbytes)]);
		default:
			throw new Error(`Unknown PoX address version: 0x${version.toString(16)}`);
	}
}

export const BtcAddress: {
	parse: typeof parseBtcAddress;
	stringify: typeof stringifyBtcAddress;
} = {
	parse: parseBtcAddress,
	stringify: stringifyBtcAddress,
};
