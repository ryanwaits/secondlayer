import { bech32, bech32m } from "@scure/base";

import { bytesToHex, hexToBytes } from "../utils/encoding.ts";
import { SBTC_BTC_ADDRESS_VERSION } from "./constants.ts";
import type { SbtcBtcRecipient } from "./types.ts";

const BASE58_ALPHABET =
	"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
	let num = 0n;
	for (const byte of bytes) num = num * 256n + BigInt(byte);

	let str = "";
	while (num > 0n) {
		const r = num % 58n;
		str = BASE58_ALPHABET[Number(r)] + str;
		num /= 58n;
	}
	for (const byte of bytes) {
		if (byte === 0) str = `1${str}`;
		else break;
	}
	return str;
}

function sha256(bytes: Uint8Array): Uint8Array {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(bytes);
	return hasher.digest() as Uint8Array;
}

function doubleSha256(bytes: Uint8Array): Uint8Array {
	return sha256(sha256(bytes));
}

function base58CheckEncode(version: number, hashbytes: Uint8Array): string {
	const payload = new Uint8Array(1 + hashbytes.length);
	payload[0] = version;
	payload.set(hashbytes, 1);
	const checksum = doubleSha256(payload).slice(0, 4);
	const full = new Uint8Array(payload.length + 4);
	full.set(payload, 0);
	full.set(checksum, payload.length);
	return base58Encode(full);
}

/**
 * Format a `(buff 1) + (buff 32)` BTC recipient tuple into a canonical
 * mainnet Bitcoin address string.
 *
 * Used to decode the `recipient` field of `withdrawal-create` events
 * into a human-readable address. Mirrors the reverse direction of the
 * `parseBtcAddress` helper in `pox/utils.ts`.
 */
export function formatBtcAddress(recipient: SbtcBtcRecipient): string {
	const { version, hashbytes } = recipient;
	switch (version) {
		case SBTC_BTC_ADDRESS_VERSION.p2pkh:
			return base58CheckEncode(0x00, hashbytes);
		case SBTC_BTC_ADDRESS_VERSION.p2sh:
		case SBTC_BTC_ADDRESS_VERSION.p2sh_p2wpkh:
		case SBTC_BTC_ADDRESS_VERSION.p2sh_p2wsh:
			return base58CheckEncode(0x05, hashbytes);
		case SBTC_BTC_ADDRESS_VERSION.p2wpkh:
		case SBTC_BTC_ADDRESS_VERSION.p2wsh: {
			const words = bech32.toWords(hashbytes);
			return bech32.encode("bc", [0, ...words]);
		}
		case SBTC_BTC_ADDRESS_VERSION.p2tr: {
			const words = bech32m.toWords(hashbytes);
			return bech32m.encode("bc", [1, ...words]);
		}
		default:
			throw new Error(`Unknown BTC address version: ${version}`);
	}
}

/**
 * Validate that a buffer is a 32-byte Bitcoin transaction id.
 * Throws if the buffer is the wrong length.
 */
export function validateBitcoinTxid(buf: Uint8Array): void {
	if (buf.length !== 32) {
		throw new Error(`Bitcoin txid must be 32 bytes, got ${buf.length}`);
	}
}

/**
 * Hex-encode a Bitcoin txid for storage / display. Throws if the input is
 * not 32 bytes.
 */
export function bitcoinTxidToHex(buf: Uint8Array): string {
	validateBitcoinTxid(buf);
	return bytesToHex(buf);
}

/**
 * Parse a hex string back into a 32-byte txid. Mirrors `bitcoinTxidToHex`.
 */
export function bitcoinTxidFromHex(hex: string): Uint8Array {
	const buf = hexToBytes(hex);
	validateBitcoinTxid(buf);
	return buf;
}

/**
 * Convert satoshis (BigInt) to a decimal-string sBTC amount.
 *
 * sBTC has 8 decimals (matching BTC). 100_000_000 sats = 1 sBTC.
 */
export function satsToSbtc(sats: bigint): string {
	const sign = sats < 0n ? "-" : "";
	const abs = sats < 0n ? -sats : sats;
	const whole = abs / 100_000_000n;
	const frac = abs % 100_000_000n;
	if (frac === 0n) return `${sign}${whole}`;
	const fracStr = frac.toString().padStart(8, "0").replace(/0+$/, "");
	return `${sign}${whole}.${fracStr}`;
}

/**
 * Parse a decimal-string sBTC amount into satoshis. Inverse of
 * {@link satsToSbtc}.
 */
export function sbtcToSats(amount: string): bigint {
	const trimmed = amount.trim();
	if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
		throw new Error(`Invalid sBTC amount: ${amount}`);
	}
	const negative = trimmed.startsWith("-");
	const body = negative ? trimmed.slice(1) : trimmed;
	const dotIndex = body.indexOf(".");
	const whole = dotIndex < 0 ? body : body.slice(0, dotIndex);
	const frac = dotIndex < 0 ? "" : body.slice(dotIndex + 1);
	if (frac.length > 8) {
		throw new Error(`sBTC amount has more than 8 decimal places: ${amount}`);
	}
	const padded = frac.padEnd(8, "0");
	const sats = BigInt(whole) * 100_000_000n + BigInt(padded);
	return negative ? -sats : sats;
}
