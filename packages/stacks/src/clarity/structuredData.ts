import { sha256 } from "@noble/hashes/sha2.js";
import type { LocalAccount } from "../accounts/types.ts";
import { bytesToHex, concatBytes } from "../utils/encoding.ts";
import { serializeCVBytes } from "./serialize.ts";
import type { ClarityValue, TupleCV } from "./types.ts";

/** asciiToBytes("SIP018") */
export const SIP018_PREFIX: Uint8Array = new Uint8Array([
	0x53, 0x49, 0x50, 0x30, 0x31, 0x38,
]);

/** sha256(serialize(cv)) — inner hash used by SIP-018. */
export function hashStructuredData(structuredData: ClarityValue): Uint8Array {
	return sha256(serializeCVBytes(structuredData));
}

function isDomain(value: ClarityValue): value is TupleCV {
	if (value.type !== "tuple") return false;
	const { name, version, "chain-id": chainId } = value.value;
	return (
		name?.type === "ascii" &&
		version?.type === "ascii" &&
		chainId?.type === "uint"
	);
}

/**
 * SIP-018 encoding: `"SIP018" || sha256(serialize(domain)) || sha256(serialize(message))`.
 * The signature is over `sha256` of this buffer.
 */
export function encodeStructuredData(opts: {
	message: ClarityValue;
	domain: ClarityValue;
}): Uint8Array {
	if (!isDomain(opts.domain)) {
		throw new Error(
			"domain must be a tuple { name: ascii, version: ascii, chain-id: uint }",
		);
	}
	return concatBytes(
		SIP018_PREFIX,
		hashStructuredData(opts.domain),
		hashStructuredData(opts.message),
	);
}

/** SIP-018 message hash: sha256(encodeStructuredData(...)). */
export function structuredDataHash(opts: {
	message: ClarityValue;
	domain: ClarityValue;
}): Uint8Array {
	return sha256(encodeStructuredData(opts));
}

/**
 * Sign a SIP-018 structured message. Returns a 65-byte recoverable signature
 * in RSV order (recovery byte last) — the layout contracts expect.
 */
export async function signStructuredData(
	account: LocalAccount,
	opts: { message: ClarityValue; domain: ClarityValue },
): Promise<string> {
	const vrs = await account.sign(structuredDataHash(opts));
	if (vrs.length !== 65) {
		throw new Error(
			`Expected 65-byte recoverable signature, got ${vrs.length}`,
		);
	}
	return bytesToHex(concatBytes(vrs.slice(1), vrs.slice(0, 1)));
}
