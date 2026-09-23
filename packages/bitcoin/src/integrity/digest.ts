/**
 * Per-block digest chain over canonical Runes state changes. Not a port of
 * any ord file — ord has no equivalent (it never needs to prove "optimized
 * decoder == original decoder"; we do, since the plan 039 hot-loop rewrite
 * must stay byte-faithful to ord 0.29.0's `rune_updater.rs`). See plan 039
 * Design → "Digest chain" for the exact format this implements.
 *
 * Every function here is pure (no DB, no RPC): the chain's whole point is
 * that `d_H` depends only on `d_{H-1}`, the block hash, and that block's own
 * events, so it can be recomputed identically on any run and resumed from
 * any previously-flushed `d_checkpoint` (see `db/store.ts` for where this
 * plugs into the flush transaction).
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { runeIdCompare, runeIdFromString } from "../runes/rune_id.ts";
import type { RuneEvent, RuneState } from "../runes/state.ts";

/** `d_{839999}` — the chain's seed, one block before the Runes activation height (840,000). */
export const GENESIS_DIGEST = new Uint8Array(32);

function concatBytes(chunks: Uint8Array[]): Uint8Array {
	const total = chunks.reduce((n, c) => n + c.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out;
}

/** bitcoind's display-order block hash (hex) -> internal (natural hash) byte order, by reversing — the inverse of `block.ts`'s `displayHex`. */
export function internalBytesFromDisplayHash(displayHash: string): Uint8Array {
	return Uint8Array.from(hexToBytes(displayHash)).reverse();
}

const KIND_ORDER: Record<RuneEvent["kind"], number> = {
	mint: 0,
	etch: 1,
	transfer: 2,
	burn: 3,
};

function eventVout(event: RuneEvent): number {
	return event.kind === "transfer" ? event.vout : -1;
}

/**
 * Sort key: `(txIndex, kindOrder, vout ?? -1, runeId as (block, tx) numeric)`.
 * Independent of Map/HashMap iteration order, so a non-TS implementation can
 * reproduce the same canonical ordering from the same event set.
 */
function compareEvents(a: RuneEvent, b: RuneEvent): number {
	if (a.txIndex !== b.txIndex) return a.txIndex - b.txIndex;
	const ka = KIND_ORDER[a.kind];
	const kb = KIND_ORDER[b.kind];
	if (ka !== kb) return ka - kb;
	const va = eventVout(a);
	const vb = eventVout(b);
	if (va !== vb) return va - vb;
	return runeIdCompare(runeIdFromString(a.runeId), runeIdFromString(b.runeId));
}

/** `-` for an absent bigint, else its decimal string — used throughout the digest line format. */
function bigOrDash(value: bigint | undefined): string {
	return value === undefined ? "-" : value.toString();
}

/** The etch line reads the rune's entry "as created" from `state` — safe because none of the fields it serializes (unlike `mints`/`burned`) are ever mutated after `createRuneEntry` sets them. */
function serializeEtchLine(
	event: Extract<RuneEvent, { kind: "etch" }>,
	state: RuneState,
): string {
	const entry = state.entries.get(event.runeId);
	if (!entry) {
		throw new Error(
			`digest: etch event for rune ${event.runeId} has no matching entry in state`,
		);
	}
	const symbolPart =
		entry.symbol !== undefined ? String(entry.symbol.codePointAt(0)) : "-";
	const termsPart =
		entry.terms === undefined
			? "-"
			: [
					bigOrDash(entry.terms.amount),
					bigOrDash(entry.terms.cap),
					bigOrDash(entry.terms.height[0]),
					bigOrDash(entry.terms.height[1]),
					bigOrDash(entry.terms.offset[0]),
					bigOrDash(entry.terms.offset[1]),
				].join(",");

	return [
		"E",
		event.txIndex,
		event.txid,
		event.runeId,
		entry.rune.toString(),
		entry.spacers,
		entry.divisibility,
		symbolPart,
		entry.premine.toString(),
		termsPart,
		entry.turbo ? 1 : 0,
		entry.number.toString(),
		entry.timestamp.toString(),
	].join("|");
}

function serializeEvent(event: RuneEvent, state: RuneState): string {
	switch (event.kind) {
		case "mint":
			return [
				"M",
				event.txIndex,
				event.txid,
				event.runeId,
				event.amount.toString(),
			].join("|");
		case "etch":
			return serializeEtchLine(event, state);
		case "transfer":
			return [
				"T",
				event.txIndex,
				event.txid,
				event.runeId,
				event.vout,
				event.amount.toString(),
			].join("|");
		case "burn":
			return [
				"B",
				event.txIndex,
				event.txid,
				event.runeId,
				event.amount.toString(),
			].join("|");
	}
}

/**
 * One block's canonical delta: its events, sorted independent of iteration
 * order, one line per event, joined by `\n`. Reading etch entries out of
 * `state` means the caller must pass a state where those runes' entries are
 * still present (true for `flush()`, which never deletes an entry).
 */
export function canonicalBlockDelta(
	events: readonly RuneEvent[],
	state: RuneState,
): string {
	const sorted = [...events].sort(compareEvents);
	return sorted.map((event) => serializeEvent(event, state)).join("\n");
}

/** `d_H = sha256(d_{H-1} ‖ blockHashInternal ‖ sha256(delta_H))`. */
export function computeBlockDigest(
	previousDigest: Uint8Array,
	blockHashInternal: Uint8Array,
	delta: string,
): Uint8Array {
	const deltaHash = sha256(new TextEncoder().encode(delta));
	return sha256(concatBytes([previousDigest, blockHashInternal, deltaHash]));
}

export interface BlockDigestRow {
	height: number;
	blockHash: string;
	digest: string;
	eventCount: number;
}

/**
 * Chains the digest across every block in `blocks` (in order), grouping
 * `events` by height. A block with no Runes activity still gets a digest row
 * (delta = empty string, event count 0) so the chain has no gaps. Pure: the
 * caller supplies `startDigest` (the previous flush's last digest, or
 * `GENESIS_DIGEST` on a fresh start) — this is what makes a flush/reload
 * resume produce the same chain as one continuous run.
 */
export function computeBlockDigests(
	startDigest: Uint8Array,
	blocks: ReadonlyArray<{ height: number; hash: string }>,
	events: readonly RuneEvent[],
	state: RuneState,
): BlockDigestRow[] {
	const eventsByHeight = new Map<number, RuneEvent[]>();
	for (const event of events) {
		let bucket = eventsByHeight.get(event.height);
		if (!bucket) {
			bucket = [];
			eventsByHeight.set(event.height, bucket);
		}
		bucket.push(event);
	}

	let previous = startDigest;
	const rows: BlockDigestRow[] = [];
	for (const { height, hash } of blocks) {
		const blockEvents = eventsByHeight.get(height) ?? [];
		const delta = canonicalBlockDelta(blockEvents, state);
		const digest = computeBlockDigest(
			previous,
			internalBytesFromDisplayHash(hash),
			delta,
		);
		rows.push({
			height,
			blockHash: hash,
			digest: bytesToHex(digest),
			eventCount: blockEvents.length,
		});
		previous = digest;
	}
	return rows;
}

function splitOutpoint(outpoint: string): { txid: string; vout: number } {
	const sep = outpoint.lastIndexOf(":");
	return {
		txid: outpoint.slice(0, sep),
		vout: Number(outpoint.slice(sep + 1)),
	};
}

/**
 * Canonical sorted dump of `rune_entries` + `rune_balances` — one line per
 * row, every column, decimal bigints. Entries sorted by RuneId (numeric,
 * `block` then `tx`); balances sorted by `(txid, vout, RuneId)`. Used only to
 * prove "optimized == original" byte-for-byte (plan 039 step 6); not a
 * public contract like the block digest chain.
 */
export function canonicalStateDump(state: RuneState): string {
	const entryIds = [...state.entries.keys()].sort((a, b) =>
		runeIdCompare(runeIdFromString(a), runeIdFromString(b)),
	);
	const entryLines = entryIds.map((runeId) => {
		// biome-ignore lint/style/noNonNullAssertion: runeId came from state.entries.keys()
		const entry = state.entries.get(runeId)!;
		const symbolPart =
			entry.symbol !== undefined ? String(entry.symbol.codePointAt(0)) : "-";
		const termsPart =
			entry.terms === undefined
				? "-"
				: [
						bigOrDash(entry.terms.amount),
						bigOrDash(entry.terms.cap),
						bigOrDash(entry.terms.height[0]),
						bigOrDash(entry.terms.height[1]),
						bigOrDash(entry.terms.offset[0]),
						bigOrDash(entry.terms.offset[1]),
					].join(",");
		return [
			"ENTRY",
			runeId,
			entry.block.toString(),
			entry.rune.toString(),
			entry.spacers,
			entry.divisibility,
			symbolPart,
			entry.premine.toString(),
			termsPart,
			entry.turbo ? 1 : 0,
			entry.etching,
			entry.timestamp.toString(),
			entry.mints.toString(),
			entry.burned.toString(),
		].join("|");
	});

	const balanceRows: Array<{
		outpoint: string;
		runeId: string;
		amount: bigint;
	}> = [];
	for (const [outpoint, byRune] of state.balances) {
		for (const [runeId, amount] of byRune) {
			balanceRows.push({ outpoint, runeId, amount });
		}
	}
	balanceRows.sort((a, b) => {
		const oa = splitOutpoint(a.outpoint);
		const ob = splitOutpoint(b.outpoint);
		if (oa.txid !== ob.txid) return oa.txid < ob.txid ? -1 : 1;
		if (oa.vout !== ob.vout) return oa.vout - ob.vout;
		return runeIdCompare(
			runeIdFromString(a.runeId),
			runeIdFromString(b.runeId),
		);
	});
	const balanceLines = balanceRows.map((row) =>
		["BAL", row.outpoint, row.runeId, row.amount.toString()].join("|"),
	);

	return [...entryLines, ...balanceLines].join("\n");
}

export function computeStateHash(state: RuneState): Uint8Array {
	return sha256(new TextEncoder().encode(canonicalStateDump(state)));
}
