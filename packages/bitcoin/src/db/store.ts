// Loads/flushes RuneState (../runes/state.ts) to Postgres. Not a port of any
// ord file — ord persists to redb tables directly from the updater; this is
// the equivalent boundary for our separate DB (D18).
//
// Batching note (added after a reviewer-caught defect): the Runes launch
// window touches tens of thousands of (outpoint, rune) balance pairs per
// 1,000-block flush, most of them created and fully spent within the same
// window (mint -> immediately transferred -> transferred again, all before
// the next flush). The first version of this file did one DELETE and one
// INSERT per touched outpoint — a single flush measured in pg_stat_activity
// issuing one-row-at-a-time statements for 45+ minutes with zero rows
// committed. `computeBalanceChanges` fixes this two ways: (1) a pair that
// was never actually persisted (created and spent within the window) is
// skipped entirely — no DELETE, no INSERT; (2) every remaining write is
// batched into chunked multi-row statements instead of one round trip per
// row.

import { hexToBytes } from "@noble/hashes/utils.js";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import {
	GENESIS_DIGEST,
	compareEvents,
	computeBlockDigests,
} from "../integrity/digest.ts";
import type { RuneEntry } from "../runes/entry.ts";
import { runeIdFromString } from "../runes/rune_id.ts";
import { spacedRuneToString } from "../runes/spaced_rune.ts";
import {
	type RuneEvent,
	type RuneState,
	balanceKey,
	createRuneState,
	getBalance,
} from "../runes/state.ts";
import {
	CHECKPOINT_NAME,
	type Database,
	type RuneEntriesTable,
} from "./types.ts";

function n(value: string): bigint {
	return BigInt(value);
}
function nOpt(value: string | null): bigint | undefined {
	return value === null ? undefined : BigInt(value);
}
function s(value: bigint): string {
	return value.toString();
}
function sOpt(value: bigint | undefined): string | null {
	return value === undefined ? null : value.toString();
}

/**
 * `entry.symbol` is a single Unicode scalar value straight off the chain
 * (a Runestone etching's `Symbol` tag accepts any u32 codepoint, including
 * 0) — but Postgres's `text` type rejects a raw NUL byte outright
 * (`22021 invalid byte sequence for encoding "UTF8": 0x00`), a Postgres
 * limitation, not a UTF-8 one. Storing `null` for that one degenerate value
 * is indistinguishable, on reload, from "no symbol" — an accepted, narrow
 * loss of fidelity in the SQL row only; the in-memory `RuneEntry.symbol` this
 * was read from (and everything derived from it before this write, including
 * the digest chain, which already turns it into a codepoint number) is
 * unaffected. Caught live during plan 039 step 7 (backfill 841,000→900,000).
 */
export function symbolForDb(symbol: string | undefined): string | null {
	if (symbol === undefined || symbol === "\u0000") return null;
	return symbol;
}

export function entryToRow(runeId: string, entry: RuneEntry): RuneEntriesTable {
	const { block, tx } = runeIdFromString(runeId);
	return {
		rune_id: runeId,
		block: s(block),
		tx: s(tx),
		number: s(entry.number),
		rune: s(entry.rune),
		spaced_rune: spacedRuneToString({
			rune: { n: entry.rune },
			spacers: entry.spacers,
		}),
		spacers: entry.spacers,
		divisibility: entry.divisibility,
		symbol: symbolForDb(entry.symbol),
		// The raw Unicode scalar, unlike `symbol` (text): survives U+0000, which
		// Postgres `text` can't store at all. Source of truth for `loadState`.
		symbol_codepoint: entry.symbol?.codePointAt(0) ?? null,
		premine: s(entry.premine),
		terms_amount: sOpt(entry.terms?.amount),
		terms_cap: sOpt(entry.terms?.cap),
		terms_height_start: sOpt(entry.terms?.height[0]),
		terms_height_end: sOpt(entry.terms?.height[1]),
		terms_offset_start: sOpt(entry.terms?.offset[0]),
		terms_offset_end: sOpt(entry.terms?.offset[1]),
		// Whether `entry.terms` was ever set, even with every field left unset
		// (ord's "terms present, all fields empty" case) — unlike checking the
		// `terms_*` columns for "any non-null", which can't tell that case apart
		// from "no terms". Source of truth for `loadState`.
		has_terms: entry.terms !== undefined,
		turbo: entry.turbo,
		etching_txid: entry.etching,
		timestamp: s(entry.timestamp),
		mints: s(entry.mints),
		burned: s(entry.burned),
		// A row written here (from the in-memory `RuneEntry`, the source of
		// truth) is correct by construction — never a candidate for
		// `cli.ts repair-entries`, which only touches pre-migration-0003 rows
		// where this is NULL.
		repaired_at: new Date(),
	};
}

/** Postgres's hard limit on bind parameters in a single extended-protocol statement. */
export const POSTGRES_MAX_PARAMETERS = 65_534;

/** Splits `items` into chunks of at most `size` — keeps every batched statement under Postgres's parameter limit. */
export function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size)
		out.push(items.slice(i, i + size));
	return out;
}

export function openStore(databaseUrl: string): Kysely<Database> {
	const client = postgres(databaseUrl, { max: 4 });
	return new Kysely<Database>({
		dialect: new PostgresJSDialect({ postgres: client }),
	});
}

/**
 * The `entryToRow` inverse — rebuilds the in-memory `RuneEntry` from a
 * `rune_entries` row. Pure (no DB access) so the round trip is directly
 * unit-testable; `loadState` is its only caller.
 */
export function rowToEntry(row: RuneEntriesTable): RuneEntry {
	return {
		block: n(row.block),
		burned: n(row.burned),
		divisibility: row.divisibility,
		etching: row.etching_txid,
		mints: n(row.mints),
		number: n(row.number),
		premine: n(row.premine),
		rune: n(row.rune),
		spacers: row.spacers,
		// `symbol_codepoint`, not the `symbol` text column: the latter can't
		// represent an etched U+0000 symbol (Postgres text rejects the raw NUL
		// byte, see `symbolForDb`), which reads back indistinguishable from
		// "no symbol". `symbol_codepoint` survives it.
		symbol:
			row.symbol_codepoint !== null
				? String.fromCodePoint(row.symbol_codepoint)
				: undefined,
		// `has_terms`, not "any terms_* column is non-null": a Terms with every
		// field unset (ord: all-null terms object) is a real "terms present"
		// case the column-non-null check can't tell apart from "no terms at
		// all" — caught in the C1 comparison at 841,000 (840257:557).
		terms: row.has_terms
			? {
					amount: nOpt(row.terms_amount),
					cap: nOpt(row.terms_cap),
					height: [nOpt(row.terms_height_start), nOpt(row.terms_height_end)],
					offset: [nOpt(row.terms_offset_start), nOpt(row.terms_offset_end)],
				}
			: undefined,
		timestamp: n(row.timestamp),
		turbo: row.turbo,
	};
}

/**
 * Rebuilds `RuneState` from Postgres. Returns a fresh state (no checkpoint)
 * when `runes_checkpoint` has no row — the caller then calls `seedGenesis`
 * and starts the backfill from 840,000.
 */
export async function loadState(db: Kysely<Database>): Promise<RuneState> {
	const state = createRuneState();

	const entries = await db.selectFrom("rune_entries").selectAll().execute();
	for (const row of entries) {
		const entry = rowToEntry(row);
		state.entries.set(row.rune_id, entry);
		state.runeToId.set(entry.rune.toString(), row.rune_id);
	}
	// `RuneEntry.number` is assigned sequentially from 0 with no gaps
	// (genesis seed = 0, every subsequent etching = previous count), so the
	// next number to hand out is simply the count of entries loaded.
	state.statisticRunes = BigInt(entries.length);

	const balances = await db.selectFrom("rune_balances").selectAll().execute();
	for (const row of balances) {
		const outpoint = `${row.txid}:${row.vout}`;
		let byOutpoint = state.balances.get(outpoint);
		if (!byOutpoint) {
			byOutpoint = new Map();
			state.balances.set(outpoint, byOutpoint);
		}
		byOutpoint.set(row.rune_id, n(row.amount));

		let byRune = state.balancesByRune.get(row.rune_id);
		if (!byRune) {
			byRune = new Map();
			state.balancesByRune.set(row.rune_id, byRune);
		}
		byRune.set(outpoint, n(row.amount));

		state.dbBalanceKeys.add(balanceKey(outpoint, row.rune_id));
		if (row.address !== null) state.balanceAddresses.set(outpoint, row.address);
	}

	const checkpoint = await db
		.selectFrom("runes_checkpoint")
		.selectAll()
		.where("name", "=", CHECKPOINT_NAME)
		.executeTakeFirst();
	if (checkpoint) {
		state.height = checkpoint.height;
		state.hash = checkpoint.hash;

		const digestRow = await db
			.selectFrom("rune_block_digests")
			.select("digest")
			.where("height", "=", checkpoint.height)
			.executeTakeFirst();
		// A checkpoint with no matching digest row means a run predating the
		// digest chain (plan 039) reached this height; resuming it starts a
		// fresh chain from GENESIS_DIGEST rather than failing closed, since the
		// chain only ever needs to prove agreement between two runs made AFTER
		// it existed.
		state.digest = digestRow
			? Uint8Array.from(hexToBytes(digestRow.digest))
			: GENESIS_DIGEST;
	}

	return state;
}

export interface BalanceRow {
	txid: string;
	vout: number;
	runeId: string;
	amount: bigint;
	/** The outpoint's mainnet address (`state.balanceAddresses`), null for a non-standard script. */
	address: string | null;
}
export interface BalanceRowKey {
	txid: string;
	vout: number;
	runeId: string;
}

function splitOutpoint(outpoint: string): { txid: string; vout: number } {
	const sep = outpoint.lastIndexOf(":");
	return {
		txid: outpoint.slice(0, sep),
		vout: Number(outpoint.slice(sep + 1)),
	};
}

/**
 * Pure (no DB access) — computes exactly which `rune_balances` rows need a
 * write for this flush, from `state.dirtyBalanceKeys` compared against
 * `state.dbBalanceKeys` (what's currently persisted). A pair whose current
 * amount is 0 AND was never in `dbBalanceKeys` is pure in-window churn and
 * appears in neither list.
 */
export function computeBalanceChanges(state: RuneState): {
	toUpsert: BalanceRow[];
	toDelete: BalanceRowKey[];
} {
	const toUpsert: BalanceRow[] = [];
	const toDelete: BalanceRowKey[] = [];

	for (const key of state.dirtyBalanceKeys) {
		const sep = key.lastIndexOf("|");
		const outpoint = key.slice(0, sep);
		const runeId = key.slice(sep + 1);
		const { txid, vout } = splitOutpoint(outpoint);

		const amount = getBalance(state, outpoint, runeId);
		const wasInDb = state.dbBalanceKeys.has(key);

		if (amount > 0n) {
			toUpsert.push({
				txid,
				vout,
				runeId,
				amount,
				address: state.balanceAddresses.get(outpoint) ?? null,
			});
		} else if (wasInDb) {
			toDelete.push({ txid, vout, runeId });
		}
		// else: created and fully spent within this flush window — never
		// touched the DB, so it needs neither a delete nor an insert.
	}

	return { toUpsert, toDelete };
}

/**
 * Pure (no DB access) — assigns each event its `event_index` (position within
 * its own block, in the digest chain's canonical order: `compareEvents`,
 * `../integrity/digest.ts`). Grouping by height first matters because one
 * flush window can span many blocks (batch backfill); the index resets per
 * block. Keyed by object identity, since `state.events` never contains the
 * same event object twice.
 */
export function assignEventIndices(
	events: readonly RuneEvent[],
): Map<RuneEvent, number> {
	const byHeight = new Map<number, RuneEvent[]>();
	for (const event of events) {
		let bucket = byHeight.get(event.height);
		if (!bucket) {
			bucket = [];
			byHeight.set(event.height, bucket);
		}
		bucket.push(event);
	}

	const indices = new Map<RuneEvent, number>();
	for (const bucket of byHeight.values()) {
		const sorted = [...bucket].sort(compareEvents);
		sorted.forEach((event, i) => indices.set(event, i));
	}
	return indices;
}

// Postgres's bind-parameter limit (POSTGRES_MAX_PARAMETERS) is per statement.
// Chunk sizes below are sized per-statement's own column count, with
// headroom — sizing this wrong crashed a real backfill run (`rune_entries`
// has 21 columns; 5,000 rows/chunk sent 105,000 params and hit
// MAX_PARAMETERS_EXCEEDED). See the `chunk sizes stay under the parameter
// limit` test in store.test.ts, which asserts these constants against their
// table's real column count so a future column addition fails loudly.
export const RUNE_BALANCES_PARAMS_PER_ROW = 5; // txid, vout, rune_id, amount, address (migration 0004)
export const RUNE_EVENTS_PARAMS_PER_ROW = 9; // height, tx_index, txid, kind, rune_id, amount, vout, event_index, address (migration 0004)
// 21 original columns + symbol_codepoint, has_terms, repaired_at (migration 0003).
export const RUNE_ENTRIES_PARAMS_PER_ROW = 24;

export const DELETE_CHUNK_SIZE = 10_000; // unnest arrays are 1 param each regardless of row count — not parameter-bound, just a sane batch size
export const UPSERT_CHUNK_SIZE = 5_000; // 4 params/row -> 20,000/chunk
export const EVENT_CHUNK_SIZE = 5_000; // 7 params/row -> 35,000/chunk
export const ENTRY_CHUNK_SIZE = 1_000; // 24 params/row -> 24,000/chunk

export interface FlushStats {
	height: number;
	balancesUpserted: number;
	balancesDeleted: number;
	entriesUpserted: number;
	eventsInserted: number;
	ms: number;
}

/**
 * Flushes dirty entries/balances/events plus the block range's `btc_blocks`
 * rows and the checkpoint, in one transaction. Runs the supply invariant
 * (over `state.dirtyRuneIds`) inside the transaction before it commits —
 * throwing rolls the whole flush back (fail closed, per plan design). Clears
 * the dirty sets/event buffer, and updates `state.dbBalanceKeys`, only after
 * a successful commit.
 */
export async function flush(
	db: Kysely<Database>,
	state: RuneState,
	blocks: Array<{ height: number; hash: string }>,
	checkInvariant: (state: RuneState, runeIds: Iterable<string>) => void,
): Promise<FlushStats> {
	if (blocks.length === 0) {
		throw new Error("flush: no blocks to flush");
	}
	const last = blocks[blocks.length - 1] as { height: number; hash: string };
	const start = performance.now();

	const { toUpsert, toDelete } = computeBalanceChanges(state);
	const dirtyEntryRows = [...state.dirtyRuneIds]
		.map((runeId) => ({ runeId, entry: state.entries.get(runeId) }))
		.filter(
			(r): r is { runeId: string; entry: RuneEntry } => r.entry !== undefined,
		);
	// Computed before the transaction (pure, no DB access) so a mid-transaction
	// failure never advances the chain — `state.digest` is only overwritten
	// after a successful commit, below.
	const startDigest = state.digest ?? GENESIS_DIGEST;
	const digestRows = computeBlockDigests(
		startDigest,
		blocks,
		state.events,
		state,
	);
	// Derived, not part of the digest chain (see migration 0004's docstring) —
	// computed from the same `state.events` the digest above was built from,
	// so it can never disagree with the canonical per-block order `d_H` proves.
	const eventIndices = assignEventIndices(state.events);

	await db.transaction().execute(async (trx) => {
		for (const batch of chunk(dirtyEntryRows, ENTRY_CHUNK_SIZE)) {
			await trx
				.insertInto("rune_entries")
				.values(batch.map(({ runeId, entry }) => entryToRow(runeId, entry)))
				.onConflict((oc) =>
					oc.column("rune_id").doUpdateSet((eb) => ({
						mints: eb.ref("excluded.mints"),
						burned: eb.ref("excluded.burned"),
					})),
				)
				.execute();
		}

		// Batched deletes via `unnest` — one round trip per chunk instead of
		// one per row. postgres.js sends the three parallel arrays as native
		// Postgres arrays; row-wise equality on the unnested triple selects
		// exactly the rows to remove.
		for (const batch of chunk(toDelete, DELETE_CHUNK_SIZE)) {
			const txids = batch.map((r) => r.txid);
			const vouts = batch.map((r) => r.vout);
			const runeIds = batch.map((r) => r.runeId);
			await sql`
				delete from rune_balances b
				using unnest(${sql.val(txids)}::text[], ${sql.val(vouts)}::int[], ${sql.val(runeIds)}::text[])
					as d(txid, vout, rune_id)
				where b.txid = d.txid and b.vout = d.vout and b.rune_id = d.rune_id
			`.execute(trx);
		}

		// Batched upserts — kysely's `.values([...])` already emits one
		// multi-row INSERT per call; chunking just keeps each statement under
		// Postgres's ~65535 bind-parameter limit (4 params/row here).
		for (const batch of chunk(toUpsert, UPSERT_CHUNK_SIZE)) {
			await trx
				.insertInto("rune_balances")
				.values(
					batch.map((r) => ({
						txid: r.txid,
						vout: r.vout,
						rune_id: r.runeId,
						amount: s(r.amount),
						address: r.address,
					})),
				)
				.onConflict((oc) =>
					oc.columns(["txid", "vout", "rune_id"]).doUpdateSet((eb) => ({
						amount: eb.ref("excluded.amount"),
						address: eb.ref("excluded.address"),
					})),
				)
				.execute();
		}

		for (const batch of chunk(state.events, EVENT_CHUNK_SIZE)) {
			await trx
				.insertInto("rune_events")
				.values(
					batch.map((event) => ({
						height: event.height,
						tx_index: event.txIndex,
						txid: event.txid,
						kind: event.kind,
						rune_id: event.runeId,
						amount: s("amount" in event ? event.amount : 0n),
						vout: "vout" in event ? event.vout : null,
						// biome-ignore lint/style/noNonNullAssertion: assignEventIndices covers every event in state.events by construction
						event_index: eventIndices.get(event)!,
						address: "address" in event ? (event.address ?? null) : null,
					})),
				)
				.execute();
		}

		if (blocks.length > 0) {
			await trx
				.insertInto("btc_blocks")
				.values(blocks.map((b) => ({ height: b.height, hash: b.hash })))
				.execute();
		}

		await trx
			.insertInto("rune_block_digests")
			.values(
				digestRows.map((row) => ({
					height: row.height,
					block_hash: row.blockHash,
					digest: row.digest,
					event_count: row.eventCount,
				})),
			)
			.execute();

		await trx
			.insertInto("runes_checkpoint")
			.values({
				name: CHECKPOINT_NAME,
				height: last.height,
				hash: last.hash,
				updated_at: new Date(),
			})
			.onConflict((oc) =>
				oc.column("name").doUpdateSet({
					height: last.height,
					hash: last.hash,
					updated_at: new Date(),
				}),
			)
			.execute();

		// Fail-closed invariant check, inside the transaction: a violation rolls
		// the whole flush back rather than persisting a corrupt state.
		checkInvariant(state, state.dirtyRuneIds);
	});

	for (const row of toUpsert) {
		state.dbBalanceKeys.add(balanceKey(`${row.txid}:${row.vout}`, row.runeId));
	}
	for (const row of toDelete) {
		state.dbBalanceKeys.delete(
			balanceKey(`${row.txid}:${row.vout}`, row.runeId),
		);
	}

	const eventsInserted = state.events.length;
	state.dirtyRuneIds.clear();
	state.dirtyBalanceKeys.clear();
	state.events = [];
	state.height = last.height;
	// biome-ignore lint/style/noNonNullAssertion: digestRows has one entry per block in `blocks`, and `flush` already threw above when `blocks` is empty
	state.digest = Uint8Array.from(hexToBytes(digestRows.at(-1)!.digest));
	state.hash = last.hash;

	return {
		height: last.height,
		balancesUpserted: toUpsert.length,
		balancesDeleted: toDelete.length,
		entriesUpserted: dirtyEntryRows.length,
		eventsInserted,
		ms: performance.now() - start,
	};
}
