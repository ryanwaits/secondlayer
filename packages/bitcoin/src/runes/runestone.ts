// Ported from ord 0.29.0 `crates/ordinals/src/runestone.rs` (+ `tag.rs`,
// `flag.rs`, `message.rs`, ported as `./tag.ts`, `./flag.ts`, `./message.ts`).
//
// `Runestone::payload`'s script-instruction scan is not itself a ported Rust
// file — ord depends on the `bitcoin` crate's `Script::instructions()` for
// this. The push/opcode classification below (CompactSize-style pushdata
// opcodes 0x00–0x4e vs. everything else being a plain opcode) mirrors that
// crate's well-known encoding; see the `all_pushdata_opcodes_are_valid` /
// `all_non_pushdata_opcodes_are_invalid` ported tests for the boundary.

import {
	type Artifact,
	artifactCenotaph,
	artifactRunestone,
} from "./artifact.ts";
import type { Edict } from "./edict.ts";
import {
	ETCHING_MAX_DIVISIBILITY,
	ETCHING_MAX_SPACERS,
	type Etching,
	defaultEtching,
	etchingSupply,
} from "./etching.ts";
import { Flag, type FlagsRef, flagTake } from "./flag.ts";
import { Flaw } from "./flaw.ts";
import { messageFromIntegers } from "./message.ts";
import { type Rune, rune } from "./rune.ts";
import { type RuneId, runeIdNew } from "./rune_id.ts";
import { Tag, tagTake } from "./tag.ts";
import type { Terms } from "./terms.ts";
import { VarintDecodeError, decode } from "./varint.ts";

export interface Runestone {
	edicts: Edict[];
	etching?: Etching;
	mint?: RuneId;
	pointer?: number;
}

export function defaultRunestone(): Runestone {
	return { edicts: [] };
}

/** `Runestone::MAGIC_NUMBER` — `OP_PUSHNUM_13`. */
export const MAGIC_NUMBER = 0x5d;
/** `Runestone::COMMIT_CONFIRMATIONS`. */
export const COMMIT_CONFIRMATIONS = 6;

const OP_RETURN = 0x6a;

export interface TxOutputLike {
	value: bigint;
	script: Uint8Array;
}

export interface TxLike {
	outputs: TxOutputLike[];
}

export type ScriptInstruction =
	| { kind: "op"; opcode: number }
	| { kind: "push"; bytes: Uint8Array }
	| { kind: "error" };

/**
 * Mirrors rust-bitcoin's `Script::instructions()` push/opcode classification.
 * Exported for reuse by `updater.ts`'s tapscript commitment scan
 * (`tx_commits_to_rune` in `rune_updater.rs` also walks pushdata instructions).
 */
export function* scriptInstructions(
	script: Uint8Array,
): Generator<ScriptInstruction> {
	let i = 0;
	while (i < script.length) {
		const opcode = script[i] as number;
		i += 1;

		if (opcode <= 0x4b) {
			// direct push of `opcode` bytes (opcode 0 == OP_0 == push empty)
			if (i + opcode > script.length) {
				yield { kind: "error" };
				return;
			}
			yield { kind: "push", bytes: script.subarray(i, i + opcode) };
			i += opcode;
		} else if (opcode === 0x4c) {
			// OP_PUSHDATA1
			if (i + 1 > script.length) {
				yield { kind: "error" };
				return;
			}
			const len = script[i] as number;
			i += 1;
			if (i + len > script.length) {
				yield { kind: "error" };
				return;
			}
			yield { kind: "push", bytes: script.subarray(i, i + len) };
			i += len;
		} else if (opcode === 0x4d) {
			// OP_PUSHDATA2
			if (i + 2 > script.length) {
				yield { kind: "error" };
				return;
			}
			const len = (script[i] as number) | ((script[i + 1] as number) << 8);
			i += 2;
			if (i + len > script.length) {
				yield { kind: "error" };
				return;
			}
			yield { kind: "push", bytes: script.subarray(i, i + len) };
			i += len;
		} else if (opcode === 0x4e) {
			// OP_PUSHDATA4
			if (i + 4 > script.length) {
				yield { kind: "error" };
				return;
			}
			const len =
				((script[i] as number) |
					((script[i + 1] as number) << 8) |
					((script[i + 2] as number) << 16) |
					((script[i + 3] as number) << 24)) >>>
				0;
			i += 4;
			if (i + len > script.length) {
				yield { kind: "error" };
				return;
			}
			yield { kind: "push", bytes: script.subarray(i, i + len) };
			i += len;
		} else {
			yield { kind: "op", opcode };
		}
	}
}

type PayloadResult =
	| { kind: "valid"; bytes: Uint8Array }
	| { kind: "invalid"; flaw: Flaw };

/** `Runestone::payload` — searches transaction outputs for `OP_RETURN OP_13 <pushes...>`. */
export function findPayload(tx: TxLike): PayloadResult | undefined {
	for (const output of tx.outputs) {
		const instructions = scriptInstructions(output.script);

		const first = instructions.next();
		if (
			first.done ||
			!(first.value.kind === "op" && first.value.opcode === OP_RETURN)
		) {
			continue;
		}

		const second = instructions.next();
		if (
			second.done ||
			!(second.value.kind === "op" && second.value.opcode === MAGIC_NUMBER)
		) {
			continue;
		}

		const bytes: number[] = [];
		for (const instruction of instructions) {
			if (instruction.kind === "error") {
				return { kind: "invalid", flaw: Flaw.InvalidScript };
			}
			if (instruction.kind === "op") {
				return { kind: "invalid", flaw: Flaw.Opcode };
			}
			for (const b of instruction.bytes) bytes.push(b);
		}

		return { kind: "valid", bytes: Uint8Array.from(bytes) };
	}

	return undefined;
}

/** `Runestone::integers` — throws `VarintDecodeError` on malformed input. */
export function runestoneIntegers(payload: Uint8Array): bigint[] {
	const integers: bigint[] = [];
	let i = 0;
	while (i < payload.length) {
		const [value, length] = decode(payload.subarray(i));
		integers.push(value);
		i += length;
	}
	return integers;
}

const U32_MAX = 0xffffffffn;
const U64_MAX = (1n << 64n) - 1n;

function charFromU32(v: bigint): string | undefined {
	if (v < 0n || v > 0x10ffffn) return undefined;
	const cp = Number(v);
	if (cp >= 0xd800 && cp <= 0xdfff) return undefined; // surrogate range — not a valid Unicode scalar value
	return String.fromCodePoint(cp);
}

/** `Runestone::decipher` — `undefined` means "no runestone in this transaction" (not a `Cenotaph`). */
export function runestoneDecipher(tx: TxLike): Artifact | undefined {
	const payloadResult = findPayload(tx);
	if (payloadResult === undefined) return undefined;
	if (payloadResult.kind === "invalid") {
		return artifactCenotaph({ flaw: payloadResult.flaw });
	}

	let integers: bigint[];
	try {
		integers = runestoneIntegers(payloadResult.bytes);
	} catch (e) {
		if (e instanceof VarintDecodeError) {
			return artifactCenotaph({ flaw: Flaw.Varint });
		}
		throw e;
	}

	const {
		flaw: messageFlaw,
		edicts,
		fields,
	} = messageFromIntegers(tx, integers);
	let flaw = messageFlaw;

	const flagsRef: FlagsRef = {
		value: tagTake(Tag.Flags, fields, 1, ([f]) => f as bigint) ?? 0n,
	};

	let etching: Etching | undefined;
	if (flagTake(Flag.Etching, flagsRef)) {
		const divisibility = tagTake(Tag.Divisibility, fields, 1, ([d]) => {
			const value = d as bigint;
			if (value < 0n || value > 255n) return undefined; // u8::try_from
			const div = Number(value);
			return div <= ETCHING_MAX_DIVISIBILITY ? div : undefined;
		});
		const premine = tagTake(Tag.Premine, fields, 1, ([p]) => p as bigint);
		const runeField = tagTake(Tag.Rune, fields, 1, ([r]) => rune(r as bigint));
		const spacers = tagTake(Tag.Spacers, fields, 1, ([s]) => {
			const value = s as bigint;
			if (value < 0n || value > U32_MAX) return undefined; // u32::try_from
			const sp = Number(value);
			return sp <= ETCHING_MAX_SPACERS ? sp : undefined;
		});
		const symbol = tagTake(Tag.Symbol, fields, 1, ([s]) =>
			charFromU32(s as bigint),
		);

		let terms: Terms | undefined;
		if (flagTake(Flag.Terms, flagsRef)) {
			const cap = tagTake(Tag.Cap, fields, 1, ([c]) => c as bigint);
			const heightStart = tagTake(Tag.HeightStart, fields, 1, ([h]) => {
				const value = h as bigint;
				return value >= 0n && value <= U64_MAX ? value : undefined;
			});
			const heightEnd = tagTake(Tag.HeightEnd, fields, 1, ([h]) => {
				const value = h as bigint;
				return value >= 0n && value <= U64_MAX ? value : undefined;
			});
			const amount = tagTake(Tag.Amount, fields, 1, ([a]) => a as bigint);
			const offsetStart = tagTake(Tag.OffsetStart, fields, 1, ([o]) => {
				const value = o as bigint;
				return value >= 0n && value <= U64_MAX ? value : undefined;
			});
			const offsetEnd = tagTake(Tag.OffsetEnd, fields, 1, ([o]) => {
				const value = o as bigint;
				return value >= 0n && value <= U64_MAX ? value : undefined;
			});
			terms = {
				cap,
				height: [heightStart, heightEnd],
				amount,
				offset: [offsetStart, offsetEnd],
			};
		}

		const turbo = flagTake(Flag.Turbo, flagsRef);

		etching = {
			...defaultEtching(),
			divisibility,
			premine,
			rune: runeField,
			spacers,
			symbol,
			terms,
			turbo,
		};
	}

	const mint = tagTake(Tag.Mint, fields, 2, ([block, txIndex]) =>
		runeIdNew(block as bigint, txIndex as bigint),
	);

	const pointer = tagTake(Tag.Pointer, fields, 1, ([p]) => {
		const value = p as bigint;
		if (value < 0n || value > U32_MAX) return undefined; // u32::try_from
		const pNum = Number(value);
		return pNum < tx.outputs.length ? pNum : undefined;
	});

	if (etching !== undefined && etchingSupply(etching) === undefined) {
		flaw = flaw ?? Flaw.SupplyOverflow;
	}

	if (flagsRef.value !== 0n) {
		flaw = flaw ?? Flaw.UnrecognizedFlag;
	}

	for (const tag of fields.keys()) {
		if (tag % 2n === 0n) {
			flaw = flaw ?? Flaw.UnrecognizedEvenTag;
			break;
		}
	}

	if (flaw !== undefined) {
		return artifactCenotaph({
			flaw,
			mint,
			etching: etching?.rune,
		});
	}

	return artifactRunestone({ edicts, etching, mint, pointer });
}

// Re-exported so callers (updater.ts, parity/decode.ts) don't need to reach
// into ./rune.ts just for the etched-rune type.
export type { Rune };
