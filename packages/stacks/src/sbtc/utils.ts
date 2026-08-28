import type { BitcoinNetwork } from "../bitcoin/constants.ts";
import { stringifyBtcAddress } from "../pox5/btcAddress.ts";
import { bytesToHex, hexToBytes } from "../utils/encoding.ts";
import type { SbtcBtcRecipient } from "./types.ts";

/**
 * Format a `(buff 1) + (buff 32)` BTC recipient tuple into a canonical
 * Bitcoin address string. Defaults to mainnet encoding; pass `network`
 * for testnet/regtest version bytes and hrp.
 *
 * Used to decode the `recipient` field of `withdrawal-create` events
 * into a human-readable address. The sBTC version bytes are the SIP-005
 * PoX bytes, so this is `stringifyBtcAddress` from `pox5` under an
 * sBTC-shaped name; unknown versions and hash lengths throw there.
 */
export function formatBtcAddress(
	recipient: SbtcBtcRecipient,
	network: BitcoinNetwork = "mainnet",
): string {
	return stringifyBtcAddress(recipient, network);
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
