// Step 6 (plan 037): diffs OUR `runestoneDecipher` against ord's own
// `/decode/{txid}` (send `Accept: application/json`; works at any ord height
// since it fetches the tx from bitcoind directly — no indexed state needed).
// JSON shapes below are copied from a live capture against ord 0.29.0
// (`stacks-feeder`, block 840,000, e.g. txid
// 11b9c94843240d65cd91ed34402017316722d3500914e68bd825d39f5eace81f, whose
// premine 21000000000000000000000000000 is exactly the precision case
// json-bigint.ts exists for) — not from reading ord's serde derives alone.

import type { ParsedBlock } from "../block.ts";
import type { Artifact } from "../runes/artifact.ts";
import { runeToString } from "../runes/rune.ts";
import { type TxLike, runestoneDecipher } from "../runes/runestone.ts";
import {
	type JsonBigIntValue,
	asArray,
	asObject,
	asString,
	parseJsonPreservingBigInts,
} from "./json-bigint.ts";

export interface NormalizedTerms {
	amount: string | null;
	cap: string | null;
	height: [string | null, string | null];
	offset: [string | null, string | null];
}

export interface NormalizedEtching {
	divisibility: number;
	premine: string;
	rune: string | null;
	spacers: number | null;
	symbol: string | null;
	terms: NormalizedTerms | null;
	turbo: boolean;
}

export interface NormalizedEdict {
	id: string;
	amount: string;
	output: number;
}

export type NormalizedArtifact =
	| {
			kind: "runestone";
			edicts: NormalizedEdict[];
			etching: NormalizedEtching | null;
			mint: string | null;
			pointer: number | null;
	  }
	| {
			kind: "cenotaph";
			etching: string | null;
			flaw: string | null;
			mint: string | null;
	  };

const OP_RETURN = 0x6a;
const MAGIC_NUMBER = 0x5d;

/** Cheap byte-level scan for `OP_RETURN OP_13` as the first two bytes of an output script — enough to select decode-diff candidates without running the full payload/instruction scan. */
export function txidsWithRunestoneMarker(block: ParsedBlock): string[] {
	const txids: string[] = [];
	for (const tx of block.txs) {
		for (const output of tx.outputs) {
			if (output.script[0] === OP_RETURN && output.script[1] === MAGIC_NUMBER) {
				txids.push(tx.txid);
				break;
			}
		}
	}
	return txids;
}

export async function fetchOrdDecode(
	ordUrl: string,
	txid: string,
	doFetch: typeof fetch = fetch,
): Promise<JsonBigIntValue> {
	const res = await doFetch(`${ordUrl}/decode/${txid}`, {
		headers: { accept: "application/json" },
	});
	if (!res.ok) {
		throw new Error(`ord /decode/${txid} failed: HTTP ${res.status}`);
	}
	const text = await res.text();
	return parseJsonPreservingBigInts(text);
}

function jsonToOptionalString(v: JsonBigIntValue | undefined): string | null {
	if (v === undefined || v === null) return null;
	if (typeof v === "bigint") return v.toString();
	if (typeof v === "string") return v;
	throw new Error(`expected string/bigint/null, got ${JSON.stringify(v)}`);
}

function jsonToNumberOrNull(v: JsonBigIntValue | undefined): number | null {
	if (v === undefined || v === null) return null;
	if (typeof v === "bigint") return Number(v);
	throw new Error(`expected bigint/null, got ${JSON.stringify(v)}`);
}

/** Normalizes ord's `/decode/{txid}` response `.runestone` field. */
export function normalizeOrdDecode(json: JsonBigIntValue): NormalizedArtifact {
	const root = asObject(json);
	if (!root) throw new Error("expected a JSON object");
	const runestoneField = asObject(root.runestone);
	if (!runestoneField) throw new Error("missing .runestone object");

	if (runestoneField.Runestone !== undefined) {
		const rs = asObject(runestoneField.Runestone);
		if (!rs) throw new Error("malformed .runestone.Runestone");

		const edicts = (asArray(rs.edicts) ?? []).map((e) => {
			const eo = asObject(e);
			if (!eo) throw new Error("malformed edict");
			return {
				id: asString(eo.id) ?? "",
				amount: jsonToOptionalString(eo.amount) ?? "0",
				output: jsonToNumberOrNull(eo.output) ?? 0,
			};
		});

		let etching: NormalizedEtching | null = null;
		const etchingObj = rs.etching === null ? null : asObject(rs.etching);
		if (etchingObj) {
			const termsObj =
				etchingObj.terms === null ? null : asObject(etchingObj.terms);
			let terms: NormalizedTerms | null = null;
			if (termsObj) {
				const height = asArray(termsObj.height) ?? [null, null];
				const offset = asArray(termsObj.offset) ?? [null, null];
				terms = {
					amount: jsonToOptionalString(termsObj.amount),
					cap: jsonToOptionalString(termsObj.cap),
					height: [
						jsonToOptionalString(height[0]),
						jsonToOptionalString(height[1]),
					],
					offset: [
						jsonToOptionalString(offset[0]),
						jsonToOptionalString(offset[1]),
					],
				};
			}
			etching = {
				divisibility: jsonToNumberOrNull(etchingObj.divisibility) ?? 0,
				premine: jsonToOptionalString(etchingObj.premine) ?? "0",
				rune: jsonToOptionalString(etchingObj.rune),
				spacers: jsonToNumberOrNull(etchingObj.spacers),
				symbol: jsonToOptionalString(etchingObj.symbol),
				terms,
				turbo: etchingObj.turbo === true,
			};
		}

		return {
			kind: "runestone",
			edicts,
			etching,
			mint: jsonToOptionalString(rs.mint),
			pointer: jsonToNumberOrNull(rs.pointer),
		};
	}

	if (runestoneField.Cenotaph !== undefined) {
		const cn = asObject(runestoneField.Cenotaph);
		if (!cn) throw new Error("malformed .runestone.Cenotaph");
		return {
			kind: "cenotaph",
			etching: jsonToOptionalString(cn.etching),
			flaw: jsonToOptionalString(cn.flaw),
			mint: jsonToOptionalString(cn.mint),
		};
	}

	throw new Error(
		`unrecognized .runestone shape (expected "Runestone" or "Cenotaph" key): ${JSON.stringify(root.runestone)}`,
	);
}

/** Normalizes our own `runestoneDecipher` output into the same shape. */
export function normalizeOurArtifact(artifact: Artifact): NormalizedArtifact {
	if (artifact.type === "cenotaph") {
		const c = artifact.cenotaph;
		return {
			kind: "cenotaph",
			etching: c.etching !== undefined ? runeToString(c.etching) : null,
			flaw: c.flaw ?? null,
			mint: c.mint !== undefined ? `${c.mint.block}:${c.mint.tx}` : null,
		};
	}

	const rs = artifact.runestone;
	return {
		kind: "runestone",
		edicts: rs.edicts.map((e) => ({
			id: `${e.id.block}:${e.id.tx}`,
			amount: e.amount.toString(),
			output: e.output,
		})),
		etching: rs.etching
			? {
					divisibility: rs.etching.divisibility ?? 0,
					premine: (rs.etching.premine ?? 0n).toString(),
					rune:
						rs.etching.rune !== undefined
							? runeToString(rs.etching.rune)
							: null,
					spacers: rs.etching.spacers ?? null,
					symbol: rs.etching.symbol ?? null,
					terms: rs.etching.terms
						? {
								amount: rs.etching.terms.amount?.toString() ?? null,
								cap: rs.etching.terms.cap?.toString() ?? null,
								height: [
									rs.etching.terms.height[0]?.toString() ?? null,
									rs.etching.terms.height[1]?.toString() ?? null,
								],
								offset: [
									rs.etching.terms.offset[0]?.toString() ?? null,
									rs.etching.terms.offset[1]?.toString() ?? null,
								],
							}
						: null,
					turbo: rs.etching.turbo,
				}
			: null,
		mint: rs.mint !== undefined ? `${rs.mint.block}:${rs.mint.tx}` : null,
		pointer: rs.pointer ?? null,
	};
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (a === null || b === null) return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b)) return false;
		if (a.length !== b.length) return false;
		return a.every((v, i) => deepEqual(v, b[i]));
	}
	if (typeof a === "object" && typeof b === "object") {
		const ak = Object.keys(a as object).sort();
		const bk = Object.keys(b as object).sort();
		if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
		return ak.every((k) =>
			deepEqual(
				(a as Record<string, unknown>)[k],
				(b as Record<string, unknown>)[k],
			),
		);
	}
	return false;
}

export interface DecodeMismatch {
	txid: string;
	ours: NormalizedArtifact;
	ord: NormalizedArtifact;
}

/** Deciphers `tx` ourselves and diffs it against ord's `/decode/{txid}`. Returns `undefined` if the two sides agree. */
export async function diffOne(
	tx: TxLike & { txid: string },
	ordUrl: string,
	doFetch?: typeof fetch,
): Promise<DecodeMismatch | undefined> {
	const ourArtifact = runestoneDecipher(tx);
	const ordJson = await fetchOrdDecode(ordUrl, tx.txid, doFetch);
	const ord = normalizeOrdDecode(ordJson);
	const ours = ourArtifact ? normalizeOurArtifact(ourArtifact) : undefined;

	if (ours === undefined) {
		// Ours found no runestone at all (shouldn't happen for a tx selected by
		// txidsWithRunestoneMarker, but treat as a mismatch rather than a crash).
		return {
			txid: tx.txid,
			ours: { kind: "cenotaph", etching: null, flaw: "MISSING", mint: null },
			ord,
		};
	}

	return deepEqual(ours, ord) ? undefined : { txid: tx.txid, ours, ord };
}
