// Ported from ord 0.29.0 `src/index/entry.rs` (RuneEntry subset relevant to
// the decoder — the redb `Entry`/`*Value` (de)serialization forms are
// PostgreSQL's job here, see ../db/store.ts) and `src/runes.rs` (`MintError`).

import type { Terms } from "./terms.ts";

export interface RuneEntry {
	block: bigint;
	burned: bigint;
	divisibility: number;
	etching: string; // txid, hex
	mints: bigint;
	number: bigint;
	premine: bigint;
	rune: bigint; // Rune.n
	spacers: number;
	symbol?: string;
	terms?: Terms;
	timestamp: bigint;
	turbo: boolean;
}

export enum MintErrorKind {
	Cap = "cap",
	End = "end",
	Start = "start",
	Unmintable = "unmintable",
}

export interface MintError {
	kind: MintErrorKind;
	/** Present for Cap/End/Start; absent for Unmintable. */
	value?: bigint;
}

function mintErr(kind: MintErrorKind, value?: bigint): MintError {
	return { kind, value };
}

export function runeEntryStart(entry: RuneEntry): bigint | undefined {
	const terms = entry.terms;
	if (!terms) return undefined;

	const relative =
		terms.offset[0] !== undefined
			? entry.block + terms.offset[0] // saturating_add — u64 overflow is not realistic for chain heights
			: undefined;
	const absolute = terms.height[0];

	if (relative !== undefined && absolute !== undefined) {
		return relative > absolute ? relative : absolute; // .max
	}
	return relative ?? absolute;
}

export function runeEntryEnd(entry: RuneEntry): bigint | undefined {
	const terms = entry.terms;
	if (!terms) return undefined;

	const relative =
		terms.offset[1] !== undefined ? entry.block + terms.offset[1] : undefined;
	const absolute = terms.height[1];

	if (relative !== undefined && absolute !== undefined) {
		return relative < absolute ? relative : absolute; // .min
	}
	return relative ?? absolute;
}

/** `RuneEntry::mintable` — `{ ok: bigint }` on success, `{ err: MintError }` on failure. */
export function runeEntryMintable(
	entry: RuneEntry,
	height: bigint,
): { ok: bigint } | { err: MintError } {
	const terms = entry.terms;
	if (!terms) return { err: mintErr(MintErrorKind.Unmintable) };

	const start = runeEntryStart(entry);
	if (start !== undefined && height < start) {
		return { err: mintErr(MintErrorKind.Start, start) };
	}

	const end = runeEntryEnd(entry);
	if (end !== undefined && height >= end) {
		return { err: mintErr(MintErrorKind.End, end) };
	}

	const cap = terms.cap ?? 0n;
	if (entry.mints >= cap) {
		return { err: mintErr(MintErrorKind.Cap, cap) };
	}

	return { ok: terms.amount ?? 0n };
}

export function runeEntrySupply(entry: RuneEntry): bigint {
	return entry.premine + entry.mints * (entry.terms?.amount ?? 0n);
}

export function runeEntryMaxSupply(entry: RuneEntry): bigint {
	return entry.premine + (entry.terms?.cap ?? 0n) * (entry.terms?.amount ?? 0n);
}
