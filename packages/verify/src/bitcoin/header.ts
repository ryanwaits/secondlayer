/**
 * Bitcoin block header wire format: 80 bytes, all integers little-endian.
 *
 *   version (i32) | prevHash (32) | merkleRoot (32) | time (u32) | bits (u32) | nonce (u32)
 *
 * Hashes are carried in display order (byte-reversed hex, as bitcoind and
 * explorers print them). `headerHash` returns the natural (internal) byte
 * order, which is what proof-of-work compares as a little-endian integer.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

export const HEADER_SIZE = 80;

export interface BlockHeader {
	/** Signed 32-bit version field. */
	version: number;
	/** Display-order hex of the previous block hash. */
	prevHash: string;
	/** Display-order hex of the merkle root. */
	merkleRoot: string;
	/** Unix timestamp, seconds. */
	time: number;
	/** Compact-encoded target. */
	bits: number;
	nonce: number;
}

function toBytes(raw: Uint8Array | string): Uint8Array {
	return typeof raw === "string" ? hexToBytes(raw) : raw;
}

/** Reverses byte order: natural <-> display. Returns a copy. */
export function reverseBytes(bytes: Uint8Array): Uint8Array {
	return Uint8Array.from(bytes).reverse();
}

export function parseHeader(raw: Uint8Array | string): BlockHeader {
	const bytes = toBytes(raw);
	if (bytes.length !== HEADER_SIZE) {
		throw new RangeError(
			`block header must be ${HEADER_SIZE} bytes, got ${bytes.length}`,
		);
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, HEADER_SIZE);
	return {
		version: view.getInt32(0, true),
		prevHash: bytesToHex(reverseBytes(bytes.subarray(4, 36))),
		merkleRoot: bytesToHex(reverseBytes(bytes.subarray(36, 68))),
		time: view.getUint32(68, true),
		bits: view.getUint32(72, true),
		nonce: view.getUint32(76, true),
	};
}

export function serializeHeader(header: BlockHeader): Uint8Array {
	const bytes = new Uint8Array(HEADER_SIZE);
	const view = new DataView(bytes.buffer);
	view.setInt32(0, header.version, true);
	bytes.set(reverseBytes(hexToBytes(header.prevHash)), 4);
	bytes.set(reverseBytes(hexToBytes(header.merkleRoot)), 36);
	view.setUint32(68, header.time, true);
	view.setUint32(72, header.bits, true);
	view.setUint32(76, header.nonce, true);
	return bytes;
}

/** Double-SHA256 of the raw header, natural (internal) byte order. */
export function headerHash(raw: Uint8Array | string): Uint8Array {
	const bytes = toBytes(raw);
	if (bytes.length !== HEADER_SIZE) {
		throw new RangeError(
			`block header must be ${HEADER_SIZE} bytes, got ${bytes.length}`,
		);
	}
	return sha256(sha256(bytes));
}

/** Block hash as display-order hex (what bitcoind prints). */
export function headerHashHex(raw: Uint8Array | string): string {
	return bytesToHex(reverseBytes(headerHash(raw)));
}
