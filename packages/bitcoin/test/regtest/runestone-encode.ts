// Minimal Runestone OP_RETURN encoder — regtest-test-only tooling (plan 057
// step 5). The package is decode-only (it only ever needs to read what ord
// wrote); there's no `Runestone::encipher` port to reuse, so this builds the
// payload directly from the ported tag/varint primitives
// (`../../src/runes/tag.ts`'s `tagEncode`, `../../src/runes/varint.ts`) —
// the same primitives `runestoneDecipher` reads, just run forward.
//
// Both helpers below deliberately omit the `Rune` tag, so `etched()`
// (`../../src/runes/updater.ts`) takes the "no candidate name" branch and
// assigns a reserved name from `(height, txIndex)` — no BIP-341
// commit-reveal taproot spend needed to satisfy `txCommitsToRune`, which a
// chosen name would require.

import { Flag } from "../../src/runes/flag.ts";
import { Tag, tagEncode } from "../../src/runes/tag.ts";

const OP_RETURN = 0x6a;
const OP_13 = 0x5d; // Runestone::MAGIC_NUMBER

function scriptFromPayload(payload: number[]): Uint8Array {
	if (payload.length > 0x4b) {
		throw new Error(
			`scriptFromPayload: payload of ${payload.length} bytes needs OP_PUSHDATA1+ (not implemented — keep test runestones small)`,
		);
	}
	return Uint8Array.of(OP_RETURN, OP_13, payload.length, ...payload);
}

export interface EtchingWithTermsOptions {
	divisibility?: number;
	premine: bigint;
	termsAmount: bigint;
	termsCap: bigint;
	turbo?: boolean;
}

/** An etching (reserved name, no commit needed) with premine + open mint terms (no height/offset bounds — mintable immediately). */
export function encodeEtchingWithTerms(
	options: EtchingWithTermsOptions,
): Uint8Array {
	const payload: number[] = [];
	let flags = 1n << BigInt(Flag.Etching);
	flags |= 1n << BigInt(Flag.Terms);
	if (options.turbo) flags |= 1n << BigInt(Flag.Turbo);

	tagEncode(Tag.Flags, [flags], payload);
	if (options.divisibility !== undefined) {
		tagEncode(Tag.Divisibility, [BigInt(options.divisibility)], payload);
	}
	tagEncode(Tag.Premine, [options.premine], payload);
	tagEncode(Tag.Cap, [options.termsCap], payload);
	tagEncode(Tag.Amount, [options.termsAmount], payload);

	return scriptFromPayload(payload);
}

/** A pure mint (no edicts) — the minted amount auto-allocates to the tx's first non-OP_RETURN output, per `updater.ts`'s default-allocation path. */
export function encodeMint(
	etchHeight: number,
	etchTxIndex: number,
): Uint8Array {
	const payload: number[] = [];
	tagEncode(Tag.Mint, [BigInt(etchHeight), BigInt(etchTxIndex)], payload);
	return scriptFromPayload(payload);
}
