// Daily spot parity (plan 062, Gate 2): a cheap continuous check between our
// own Runes ingest and ord, without a full-chain dump. Waits for ord's own
// tip (`/blockheight`) to reach our checkpoint, then compares mints/burned/
// supply for the runes with the most events in the last `windowBlocks`
// blocks against ord's `/rune/<id>` JSON — a handful of HTTP calls instead
// of the weekly frozen-parity full dump+diff (`cli.ts parity-state`).
//
// ord's `/rune/<id>` JSON (`Accept: application/json`) shape used here:
// `{"entry": {block, burned, divisibility, etching, mints, number, premine,
// spaced_rune, symbol, terms, timestamp, turbo}, "id", "mintable", "parent"}`
// — ord's raw `RuneEntry` struct, NOT the `RuneInfo`-shaped `ord ... runes`
// CLI dump `parity/state.ts` reads (that one adds its own computed "supply"
// and "rune" fields). There is no "supply" field on `RuneEntry` itself;
// `normalizeOrdRuneEntry` computes it the same way `runeEntrySupply`
// (`../runes/entry.ts`) does for ours: premine + mints*terms.amount.
// Verified against live ord 0.29.0 `/rune/840000:3` (DOG•GO•TO•THE•MOON),
// 2026-09-28: mints=0, burned=2440680717188, terms=null → supply=premine.

import type { Kysely } from "kysely";
import type { Database } from "../db/types.ts";
import { CHECKPOINT_NAME } from "../db/types.ts";
import {
	type JsonBigIntValue,
	asObject,
	parseJsonPreservingBigInts,
} from "./json-bigint.ts";

const DEFAULT_WINDOW_BLOCKS = 144;
const DEFAULT_TOP_N = 100;
const DEFAULT_POLL_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 30 * 1000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ord's `/blockheight` — a plain-text integer response, not JSON (ord's own convention for this one endpoint). */
export async function fetchOrdBlockHeight(
	ordUrl: string,
	doFetch: typeof fetch = fetch,
): Promise<number> {
	const res = await doFetch(`${ordUrl}/blockheight`);
	if (!res.ok) throw new Error(`ord /blockheight failed: HTTP ${res.status}`);
	const text = (await res.text()).trim();
	const height = Number(text);
	if (!Number.isInteger(height)) {
		throw new Error(`ord /blockheight returned a non-integer: "${text}"`);
	}
	return height;
}

/** Our own checkpoint height (`runes_checkpoint`); `undefined` if never checkpointed. */
export async function fetchOurCheckpointHeight(
	db: Kysely<Database>,
): Promise<number | undefined> {
	const row = await db
		.selectFrom("runes_checkpoint")
		.select("height")
		.where("name", "=", CHECKPOINT_NAME)
		.executeTakeFirst();
	return row?.height;
}

export interface WaitForOrdMatchDeps {
	ordUrl: string;
	doFetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	/** Defaults to 30 minutes (plan 062 design). */
	timeoutMs?: number;
	/** Defaults to 30 seconds. */
	intervalMs?: number;
	/** Test seam: overrides the real `fetchOrdBlockHeight` call. */
	fetchHeight?: (ordUrl: string, doFetch: typeof fetch) => Promise<number>;
}

/**
 * Polls ord's `/blockheight` until it exactly equals `ourHeight`, up to
 * `timeoutMs`. Throws on timeout rather than comparing stats against a ord
 * tip that hasn't caught up (or has raced past) our checkpoint.
 */
export async function waitForOrdCheckpointMatch(
	ourHeight: number,
	deps: WaitForOrdMatchDeps,
): Promise<void> {
	const doFetch = deps.doFetch ?? fetch;
	const sleepFn = deps.sleep ?? sleep;
	const now = deps.now ?? Date.now;
	const timeoutMs = deps.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
	const intervalMs = deps.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const fetchHeight = deps.fetchHeight ?? fetchOrdBlockHeight;

	const deadline = now() + timeoutMs;
	let lastSeen: number | undefined;
	for (;;) {
		const ordHeight = await fetchHeight(deps.ordUrl, doFetch);
		if (ordHeight === ourHeight) return;
		lastSeen = ordHeight;
		if (now() >= deadline) {
			throw new Error(
				`ord never reached our checkpoint height ${ourHeight} within ${timeoutMs}ms (last seen: ${lastSeen})`,
			);
		}
		await sleepFn(intervalMs);
	}
}

/**
 * Rune ids with the most `rune_events` rows in the last `windowBlocks` blocks
 * up to and including `toHeight` — ties broken by `rune_id` for determinism.
 */
export async function topRuneIdsByRecentEvents(
	db: Kysely<Database>,
	toHeight: number,
	windowBlocks: number = DEFAULT_WINDOW_BLOCKS,
	limit: number = DEFAULT_TOP_N,
): Promise<string[]> {
	const fromHeight = toHeight - windowBlocks + 1;
	const rows = await db
		.selectFrom("rune_events")
		.select(["rune_id", db.fn.countAll<string>().as("event_count")])
		.where("height", ">=", fromHeight)
		.where("height", "<=", toHeight)
		.groupBy("rune_id")
		.orderBy("event_count", "desc")
		.orderBy("rune_id", "asc")
		.limit(limit)
		.execute();
	return rows.map((r) => r.rune_id);
}

export interface RuneStats {
	mints: bigint;
	burned: bigint;
	/** premine + mints*terms.amount — matches `runeEntrySupply` (`../runes/entry.ts`); excludes `burned`, same as ord's own definition. */
	supply: bigint;
}

/** Our own mints/burned/supply for a set of rune ids, straight from `rune_entries` (cheaper than `loadState` for a handful of runes). */
export async function ourRuneStats(
	db: Kysely<Database>,
	runeIds: string[],
): Promise<Map<string, RuneStats>> {
	const out = new Map<string, RuneStats>();
	if (runeIds.length === 0) return out;

	const rows = await db
		.selectFrom("rune_entries")
		.select(["rune_id", "mints", "burned", "premine", "terms_amount"])
		.where("rune_id", "in", runeIds)
		.execute();
	for (const row of rows) {
		const mints = BigInt(row.mints);
		const burned = BigInt(row.burned);
		const premine = BigInt(row.premine);
		const termsAmount = row.terms_amount ? BigInt(row.terms_amount) : 0n;
		out.set(row.rune_id, {
			mints,
			burned,
			supply: premine + mints * termsAmount,
		});
	}
	return out;
}

function toBigInt(v: JsonBigIntValue | undefined, fallback = 0n): bigint {
	if (v === undefined || v === null) return fallback;
	if (typeof v === "bigint") return v;
	if (typeof v === "string") return BigInt(v);
	throw new Error(`expected bigint/string/null, got ${JSON.stringify(v)}`);
}

/** Parses ord's `/rune/<id>` JSON — see this file's header for the shape and its unverified-live-capture caveat. */
export function normalizeOrdRuneEntry(json: JsonBigIntValue): RuneStats {
	const root = asObject(json);
	if (!root) throw new Error("expected a JSON object");
	const entry = asObject(root.entry);
	if (!entry) throw new Error("missing .entry object");

	const mints = toBigInt(entry.mints);
	const burned = toBigInt(entry.burned);
	const premine = toBigInt(entry.premine);
	const termsObj =
		entry.terms === null || entry.terms === undefined
			? null
			: asObject(entry.terms);
	const termsAmount = termsObj ? toBigInt(termsObj.amount) : 0n;

	return { mints, burned, supply: premine + mints * termsAmount };
}

export async function fetchOrdRuneEntry(
	ordUrl: string,
	runeId: string,
	doFetch: typeof fetch = fetch,
): Promise<RuneStats> {
	const res = await doFetch(`${ordUrl}/rune/${runeId}`, {
		headers: { accept: "application/json" },
	});
	if (!res.ok) {
		throw new Error(`ord /rune/${runeId} failed: HTTP ${res.status}`);
	}
	const text = await res.text();
	return normalizeOrdRuneEntry(parseJsonPreservingBigInts(text));
}

export interface SpotParityMismatch {
	runeId: string;
	field: "mints" | "burned" | "supply";
	ours: string;
	ord: string;
}

/** Diffs mints/burned/supply for one rune. Empty when both sides agree on all three. */
export function compareRuneStats(
	runeId: string,
	ours: RuneStats,
	ord: RuneStats,
): SpotParityMismatch[] {
	const mismatches: SpotParityMismatch[] = [];
	for (const field of ["mints", "burned", "supply"] as const) {
		if (ours[field] !== ord[field]) {
			mismatches.push({
				runeId,
				field,
				ours: ours[field].toString(),
				ord: ord[field].toString(),
			});
		}
	}
	return mismatches;
}

export interface SpotParityDeps {
	db: Kysely<Database>;
	ordUrl: string;
	doFetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	pollTimeoutMs?: number;
	pollIntervalMs?: number;
	windowBlocks?: number;
	topN?: number;
	// Test seams — default to the real DB/HTTP implementations above.
	fetchCheckpoint?: (db: Kysely<Database>) => Promise<number | undefined>;
	fetchOrdHeight?: (ordUrl: string, doFetch: typeof fetch) => Promise<number>;
	fetchTopRuneIds?: (
		db: Kysely<Database>,
		toHeight: number,
		windowBlocks: number,
		limit: number,
	) => Promise<string[]>;
	fetchOurStats?: (
		db: Kysely<Database>,
		runeIds: string[],
	) => Promise<Map<string, RuneStats>>;
	fetchOrdStats?: (
		ordUrl: string,
		runeId: string,
		doFetch: typeof fetch,
	) => Promise<RuneStats>;
}

export interface SpotParityResult {
	checkpointHeight: number;
	runesChecked: number;
	mismatches: SpotParityMismatch[];
}

/**
 * Daily spot parity (plan 062, Gate 2): waits for ord to reach our
 * checkpoint (up to 30 min), then compares mints/burned/supply for the runes
 * with the most recent activity — cheap enough to run every day, unlike the
 * weekly full-dump frozen parity (`cli.ts parity-state`).
 */
export async function runSpotParity(
	deps: SpotParityDeps,
): Promise<SpotParityResult> {
	const doFetch = deps.doFetch ?? fetch;
	const fetchCheckpoint = deps.fetchCheckpoint ?? fetchOurCheckpointHeight;
	const fetchTopRuneIds = deps.fetchTopRuneIds ?? topRuneIdsByRecentEvents;
	const fetchOurStats = deps.fetchOurStats ?? ourRuneStats;
	const fetchOrdStats = deps.fetchOrdStats ?? fetchOrdRuneEntry;

	const checkpointHeight = await fetchCheckpoint(deps.db);
	if (checkpointHeight === undefined) {
		throw new Error("no runes checkpoint yet — nothing to compare");
	}

	await waitForOrdCheckpointMatch(checkpointHeight, {
		ordUrl: deps.ordUrl,
		doFetch,
		sleep: deps.sleep,
		now: deps.now,
		timeoutMs: deps.pollTimeoutMs,
		intervalMs: deps.pollIntervalMs,
		fetchHeight: deps.fetchOrdHeight,
	});

	const runeIds = await fetchTopRuneIds(
		deps.db,
		checkpointHeight,
		deps.windowBlocks ?? DEFAULT_WINDOW_BLOCKS,
		deps.topN ?? DEFAULT_TOP_N,
	);

	const ours = await fetchOurStats(deps.db, runeIds);
	const mismatches: SpotParityMismatch[] = [];
	for (const runeId of runeIds) {
		const ourStats = ours.get(runeId);
		// Shouldn't happen — runeId came from our own rune_events, so
		// rune_entries must have a matching row — but a mismatch here is a
		// real bug worth surfacing, not a silent skip.
		if (!ourStats) {
			mismatches.push({
				runeId,
				field: "supply",
				ours: "MISSING rune_entries row",
				ord: "(not fetched)",
			});
			continue;
		}
		const ordStats = await fetchOrdStats(deps.ordUrl, runeId, doFetch);
		mismatches.push(...compareRuneStats(runeId, ourStats, ordStats));
	}

	return { checkpointHeight, runesChecked: runeIds.length, mismatches };
}
