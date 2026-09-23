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

import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import type { RuneEntry } from "../runes/entry.ts";
import { runeIdFromString } from "../runes/rune_id.ts";
import { spacedRuneToString } from "../runes/spaced_rune.ts";
import {
	type RuneState,
	balanceKey,
	createRuneState,
	getBalance,
} from "../runes/state.ts";
import { CHECKPOINT_NAME, type Database } from "./types.ts";

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

/** Splits `items` into chunks of at most `size` — keeps every batched statement under Postgres's parameter limit. */
function chunk<T>(items: T[], size: number): T[][] {
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
 * Rebuilds `RuneState` from Postgres. Returns a fresh state (no checkpoint)
 * when `runes_checkpoint` has no row — the caller then calls `seedGenesis`
 * and starts the backfill from 840,000.
 */
export async function loadState(db: Kysely<Database>): Promise<RuneState> {
	const state = createRuneState();

	const entries = await db.selectFrom("rune_entries").selectAll().execute();
	for (const row of entries) {
		const entry: RuneEntry = {
			block: n(row.block),
			burned: n(row.burned),
			divisibility: row.divisibility,
			etching: row.etching_txid,
			mints: n(row.mints),
			number: n(row.number),
			premine: n(row.premine),
			rune: n(row.rune),
			spacers: row.spacers,
			symbol: row.symbol ?? undefined,
			terms:
				row.terms_amount !== null ||
				row.terms_cap !== null ||
				row.terms_height_start !== null ||
				row.terms_height_end !== null ||
				row.terms_offset_start !== null ||
				row.terms_offset_end !== null
					? {
							amount: nOpt(row.terms_amount),
							cap: nOpt(row.terms_cap),
							height: [
								nOpt(row.terms_height_start),
								nOpt(row.terms_height_end),
							],
							offset: [
								nOpt(row.terms_offset_start),
								nOpt(row.terms_offset_end),
							],
						}
					: undefined,
			timestamp: n(row.timestamp),
			turbo: row.turbo,
		};
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
	}

	const checkpoint = await db
		.selectFrom("runes_checkpoint")
		.selectAll()
		.where("name", "=", CHECKPOINT_NAME)
		.executeTakeFirst();
	if (checkpoint) {
		state.height = checkpoint.height;
		state.hash = checkpoint.hash;
	}

	return state;
}

export interface BalanceRow {
	txid: string;
	vout: number;
	ruleId: string;
	amount: bigint;
}
export interface BalanceRowKey {
	txid: string;
	vout: number;
	ruleId: string;
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
		const ruleId = key.slice(sep + 1);
		const { txid, vout } = splitOutpoint(outpoint);

		const amount = getBalance(state, outpoint, ruleId);
		const wasInDb = state.dbBalanceKeys.has(key);

		if (amount > 0n) {
			toUpsert.push({ txid, vout, ruleId, amount });
		} else if (wasInDb) {
			toDelete.push({ txid, vout, ruleId });
		}
		// else: created and fully spent within this flush window — never
		// touched the DB, so it needs neither a delete nor an insert.
	}

	return { toUpsert, toDelete };
}

const DELETE_CHUNK_SIZE = 10_000;
const UPSERT_CHUNK_SIZE = 5_000;
const EVENT_CHUNK_SIZE = 5_000;
const ENTRY_CHUNK_SIZE = 5_000;

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
	checkInvariant: (state: RuneState, ruleIds: Iterable<string>) => void,
): Promise<FlushStats> {
	if (blocks.length === 0) {
		throw new Error("flush: no blocks to flush");
	}
	const last = blocks[blocks.length - 1] as { height: number; hash: string };
	const start = performance.now();

	const { toUpsert, toDelete } = computeBalanceChanges(state);
	const dirtyEntryRows = [...state.dirtyRuneIds]
		.map((ruleId) => ({ ruleId, entry: state.entries.get(ruleId) }))
		.filter(
			(r): r is { ruleId: string; entry: RuneEntry } => r.entry !== undefined,
		);

	await db.transaction().execute(async (trx) => {
		for (const batch of chunk(dirtyEntryRows, ENTRY_CHUNK_SIZE)) {
			await trx
				.insertInto("rune_entries")
				.values(
					batch.map(({ ruleId, entry }) => {
						const { block, tx } = runeIdFromString(ruleId);
						return {
							rune_id: ruleId,
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
							symbol: entry.symbol ?? null,
							premine: s(entry.premine),
							terms_amount: sOpt(entry.terms?.amount),
							terms_cap: sOpt(entry.terms?.cap),
							terms_height_start: sOpt(entry.terms?.height[0]),
							terms_height_end: sOpt(entry.terms?.height[1]),
							terms_offset_start: sOpt(entry.terms?.offset[0]),
							terms_offset_end: sOpt(entry.terms?.offset[1]),
							turbo: entry.turbo,
							etching_txid: entry.etching,
							timestamp: s(entry.timestamp),
							mints: s(entry.mints),
							burned: s(entry.burned),
						};
					}),
				)
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
			const ruleIds = batch.map((r) => r.ruleId);
			await sql`
				delete from rune_balances b
				using unnest(${sql.val(txids)}::text[], ${sql.val(vouts)}::int[], ${sql.val(ruleIds)}::text[])
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
						rune_id: r.ruleId,
						amount: s(r.amount),
					})),
				)
				.onConflict((oc) =>
					oc
						.columns(["txid", "vout", "rune_id"])
						.doUpdateSet((eb) => ({ amount: eb.ref("excluded.amount") })),
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
						rune_id: event.ruleId,
						amount: s("amount" in event ? event.amount : 0n),
						vout: "vout" in event ? event.vout : null,
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
		state.dbBalanceKeys.add(balanceKey(`${row.txid}:${row.vout}`, row.ruleId));
	}
	for (const row of toDelete) {
		state.dbBalanceKeys.delete(
			balanceKey(`${row.txid}:${row.vout}`, row.ruleId),
		);
	}

	const eventsInserted = state.events.length;
	state.dirtyRuneIds.clear();
	state.dirtyBalanceKeys.clear();
	state.events = [];
	state.height = last.height;
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
