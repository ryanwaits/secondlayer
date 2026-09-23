import { type RuneEntry, runeEntrySupply } from "../runes/entry.ts";
import { spacedRuneToString } from "../runes/spaced_rune.ts";
import type { RuneState } from "../runes/state.ts";
// Step 7 (plan 037): diffs OUR state (rune_entries + rune_balances) against
// ord's `runes` / `balances` CLI JSON at a frozen height. Field names below
// are copied from a live capture against ord 0.29.0 (`ord ... runes`,
// `stacks-feeder`, height 246,489 — see test/fixtures/sample-ord-*.json),
// not from reading source alone. Two things the capture revealed that aren't
// obvious from the Rust struct definitions:
//   - the `runes` map's inner "rune" field is the SPACED display name (with
//     `•`), not the raw unspaced name — `RuneEntry` itself has no such field;
//     this must be `RuneInfo`-style view assembled by the `ord` binary crate.
//   - "timestamp" is an RFC3339 string ("1970-01-01T00:00:00Z"), not a raw
//     unix-seconds integer.
import {
	type JsonBigIntValue,
	asArray,
	asObject,
	asString,
} from "./json-bigint.ts";

export interface NormalizedTerms {
	amount: string | null;
	cap: string | null;
	height: [string | null, string | null];
	offset: [string | null, string | null];
}

export interface NormalizedRuneInfo {
	runeId: string; // "block:tx"
	block: string;
	tx: string;
	burned: string;
	divisibility: number;
	etching: string;
	mints: string;
	number: string;
	premine: string;
	spacedRune: string;
	supply: string;
	symbol: string | null;
	terms: NormalizedTerms | null;
	timestampUnixSeconds: string;
	turbo: boolean;
}

function jsonToStr(v: JsonBigIntValue | undefined): string | null {
	if (v === undefined || v === null) return null;
	if (typeof v === "bigint") return v.toString();
	if (typeof v === "string") return v;
	throw new Error(`expected string/bigint/null, got ${JSON.stringify(v)}`);
}
function jsonToNum(v: JsonBigIntValue | undefined): number {
	if (typeof v === "bigint") return Number(v);
	throw new Error(`expected bigint, got ${JSON.stringify(v)}`);
}

/** RFC3339 ("1970-01-01T00:00:00Z") -> unix seconds, as a string (no `Number` on the u128 fields elsewhere in this file — this one field is a small, ordinary timestamp, not a token value). */
function rfc3339ToUnixSeconds(s: string): string {
	const ms = Date.parse(s);
	if (Number.isNaN(ms)) throw new Error(`invalid RFC3339 timestamp: ${s}`);
	return Math.floor(ms / 1000).toString();
}

/** Normalizes `ord ... runes` JSON (`{"runes": {"<NAME>": {...}}}`) into `RuneId string -> NormalizedRuneInfo`. */
export function normalizeOrdRunesJson(
	json: JsonBigIntValue,
): Map<string, NormalizedRuneInfo> {
	const root = asObject(json);
	if (!root) throw new Error("expected a JSON object");
	const runes = asObject(root.runes);
	if (!runes) throw new Error("missing .runes object");

	const out = new Map<string, NormalizedRuneInfo>();
	for (const value of Object.values(runes)) {
		const o = asObject(value);
		if (!o) throw new Error("malformed rune entry");

		const id = asString(o.id);
		if (!id) throw new Error("rune entry missing .id");

		const [block, tx] = id.split(":");
		if (block === undefined || tx === undefined) {
			throw new Error(`malformed RuneId: ${id}`);
		}

		const termsObj = o.terms === null ? null : asObject(o.terms);
		let terms: NormalizedTerms | null = null;
		if (termsObj) {
			const height = asArray(termsObj.height) ?? [null, null];
			const offset = asArray(termsObj.offset) ?? [null, null];
			terms = {
				amount: jsonToStr(termsObj.amount),
				cap: jsonToStr(termsObj.cap),
				height: [jsonToStr(height[0]), jsonToStr(height[1])],
				offset: [jsonToStr(offset[0]), jsonToStr(offset[1])],
			};
		}

		const timestamp = asString(o.timestamp);
		if (!timestamp) throw new Error("rune entry missing .timestamp");

		out.set(id, {
			runeId: id,
			block,
			tx,
			burned: jsonToStr(o.burned) ?? "0",
			divisibility: jsonToNum(o.divisibility),
			etching: asString(o.etching) ?? "",
			mints: jsonToStr(o.mints) ?? "0",
			number: jsonToStr(o.number) ?? "0",
			premine: jsonToStr(o.premine) ?? "0",
			spacedRune: asString(o.rune) ?? "",
			supply: jsonToStr(o.supply) ?? "0",
			symbol: asString(o.symbol) ?? null,
			terms,
			timestampUnixSeconds: rfc3339ToUnixSeconds(timestamp),
			turbo: o.turbo === true,
		});
	}
	return out;
}

/** Normalizes our own `RuneState.entries` into the same shape, for a 1:1 diff against `normalizeOrdRunesJson`'s output. */
export function normalizeOurEntries(
	state: RuneState,
): Map<string, NormalizedRuneInfo> {
	const out = new Map<string, NormalizedRuneInfo>();
	for (const [runeId, entry] of state.entries) {
		out.set(runeId, normalizeOurEntry(runeId, entry));
	}
	return out;
}

export function normalizeOurEntry(
	runeId: string,
	entry: RuneEntry,
): NormalizedRuneInfo {
	const [block, tx] = runeId.split(":");
	if (block === undefined || tx === undefined) {
		throw new Error(`malformed RuneId: ${runeId}`);
	}
	return {
		runeId,
		block,
		tx,
		burned: entry.burned.toString(),
		divisibility: entry.divisibility,
		etching: entry.etching,
		mints: entry.mints.toString(),
		number: entry.number.toString(),
		premine: entry.premine.toString(),
		spacedRune: spacedRuneToString({
			rune: { n: entry.rune },
			spacers: entry.spacers,
		}),
		supply: runeEntrySupply(entry).toString(),
		symbol: entry.symbol ?? null,
		terms: entry.terms
			? {
					amount: entry.terms.amount?.toString() ?? null,
					cap: entry.terms.cap?.toString() ?? null,
					height: [
						entry.terms.height[0]?.toString() ?? null,
						entry.terms.height[1]?.toString() ?? null,
					],
					offset: [
						entry.terms.offset[0]?.toString() ?? null,
						entry.terms.offset[1]?.toString() ?? null,
					],
				}
			: null,
		timestampUnixSeconds: entry.timestamp.toString(),
		turbo: entry.turbo,
	};
}

export interface NormalizedBalanceRow {
	outpoint: string; // "txid:vout"
	runeId: string;
	amount: string;
}

/** Normalizes `ord ... balances` JSON (`{"runes": {"<SPACED RUNE>": {"<outpoint>": {"amount": N, ...}}}}`) using a spaced-rune-name -> RuneId lookup built from the matching `runes` sample. */
export function normalizeOrdBalancesJson(
	json: JsonBigIntValue,
	runeInfoByName: Map<string, string>, // spacedRune -> runeId
): NormalizedBalanceRow[] {
	const root = asObject(json);
	if (!root) throw new Error("expected a JSON object");
	const runes = asObject(root.runes);
	if (!runes) throw new Error("missing .runes object");

	const out: NormalizedBalanceRow[] = [];
	for (const [spacedRune, outpoints] of Object.entries(runes)) {
		const runeId = runeInfoByName.get(spacedRune);
		if (!runeId) {
			throw new Error(
				`balances reference rune "${spacedRune}" not present in the runes sample — pass a runes file covering the same rune set`,
			);
		}
		const outpointsObj = asObject(outpoints);
		if (!outpointsObj) throw new Error(`malformed balances for ${spacedRune}`);
		for (const [outpoint, detail] of Object.entries(outpointsObj)) {
			const detailObj = asObject(detail);
			if (!detailObj)
				throw new Error(`malformed balance detail for ${outpoint}`);
			out.push({
				outpoint,
				runeId,
				amount: jsonToStr(detailObj.amount) ?? "0",
			});
		}
	}
	return out;
}

/** Builds the spacedRune -> runeId lookup `normalizeOrdBalancesJson` needs, from a `normalizeOrdRunesJson` (or `normalizeOurEntries`) result. */
export function runeIdByName(
	entries: Map<string, NormalizedRuneInfo>,
): Map<string, string> {
	const out = new Map<string, string>();
	for (const info of entries.values()) out.set(info.spacedRune, info.runeId);
	return out;
}

/** Normalizes our own `RuneState.balances` into the same shape. */
export function normalizeOurBalances(state: RuneState): NormalizedBalanceRow[] {
	const out: NormalizedBalanceRow[] = [];
	for (const [outpoint, byRune] of state.balances) {
		for (const [runeId, amount] of byRune) {
			out.push({ outpoint, runeId, amount: amount.toString() });
		}
	}
	return out;
}

export type EntryMismatch =
	| { kind: "missing-in-ours"; runeId: string; ord: NormalizedRuneInfo }
	| { kind: "missing-in-ord"; runeId: string; ours: NormalizedRuneInfo }
	| {
			kind: "field-mismatch";
			runeId: string;
			field: string;
			ours: unknown;
			ord: unknown;
	  };

const COMPARABLE_FIELDS: Array<keyof NormalizedRuneInfo> = [
	"block",
	"tx",
	"burned",
	"divisibility",
	"etching",
	"mints",
	"number",
	"premine",
	"spacedRune",
	"supply",
	"symbol",
	"turbo",
];

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === null || b === null) return false;
	if (typeof a !== "object" || typeof b !== "object") return false;
	return JSON.stringify(a) === JSON.stringify(b);
}

export function diffEntries(
	ours: Map<string, NormalizedRuneInfo>,
	ord: Map<string, NormalizedRuneInfo>,
): EntryMismatch[] {
	const mismatches: EntryMismatch[] = [];
	const allIds = new Set([...ours.keys(), ...ord.keys()]);

	for (const runeId of allIds) {
		const o = ours.get(runeId);
		const r = ord.get(runeId);

		if (!r) {
			// biome-ignore lint/style/noNonNullAssertion: runeId came from the union of both maps' keys
			mismatches.push({ kind: "missing-in-ord", runeId, ours: o! });
			continue;
		}
		if (!o) {
			mismatches.push({ kind: "missing-in-ours", runeId, ord: r });
			continue;
		}

		for (const field of COMPARABLE_FIELDS) {
			if (!deepEqual(o[field], r[field])) {
				mismatches.push({
					kind: "field-mismatch",
					runeId,
					field,
					ours: o[field],
					ord: r[field],
				});
			}
		}
		if (!deepEqual(o.terms, r.terms)) {
			mismatches.push({
				kind: "field-mismatch",
				runeId,
				field: "terms",
				ours: o.terms,
				ord: r.terms,
			});
		}
	}

	return mismatches;
}

export type BalanceMismatch =
	| { kind: "missing-in-ours"; outpoint: string; runeId: string; ord: string }
	| { kind: "missing-in-ord"; outpoint: string; runeId: string; ours: string }
	| {
			kind: "amount-mismatch";
			outpoint: string;
			runeId: string;
			ours: string;
			ord: string;
	  };

export function diffBalances(
	ours: NormalizedBalanceRow[],
	ord: NormalizedBalanceRow[],
): BalanceMismatch[] {
	const key = (r: NormalizedBalanceRow) => `${r.outpoint}|${r.runeId}`;
	const oursByKey = new Map(ours.map((r) => [key(r), r]));
	const ordByKey = new Map(ord.map((r) => [key(r), r]));
	const allKeys = new Set([...oursByKey.keys(), ...ordByKey.keys()]);

	const mismatches: BalanceMismatch[] = [];
	for (const k of allKeys) {
		const o = oursByKey.get(k);
		const r = ordByKey.get(k);

		if (!r) {
			// biome-ignore lint/style/noNonNullAssertion: k came from the union of both maps' keys
			const row = o!;
			mismatches.push({
				kind: "missing-in-ord",
				outpoint: row.outpoint,
				runeId: row.runeId,
				ours: row.amount,
			});
			continue;
		}
		if (!o) {
			mismatches.push({
				kind: "missing-in-ours",
				outpoint: r.outpoint,
				runeId: r.runeId,
				ord: r.amount,
			});
			continue;
		}
		if (o.amount !== r.amount) {
			mismatches.push({
				kind: "amount-mismatch",
				outpoint: o.outpoint,
				runeId: o.runeId,
				ours: o.amount,
				ord: r.amount,
			});
		}
	}
	return mismatches;
}

export interface StateDiffReport {
	height: number;
	runeCounts: { ours: number; ord: number };
	outpointCounts: { ours: number; ord: number };
	entryMismatches: EntryMismatch[];
	balanceMismatches: BalanceMismatch[];
}

export function buildStateDiffReport(
	height: number,
	ourEntries: Map<string, NormalizedRuneInfo>,
	ordEntries: Map<string, NormalizedRuneInfo>,
	ourBalances: NormalizedBalanceRow[],
	ordBalances: NormalizedBalanceRow[],
): StateDiffReport {
	return {
		height,
		runeCounts: { ours: ourEntries.size, ord: ordEntries.size },
		outpointCounts: {
			ours: new Set(ourBalances.map((r) => r.outpoint)).size,
			ord: new Set(ordBalances.map((r) => r.outpoint)).size,
		},
		entryMismatches: diffEntries(ourEntries, ordEntries),
		balanceMismatches: diffBalances(ourBalances, ordBalances),
	};
}
