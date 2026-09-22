// Loads/flushes RuneState (../runes/state.ts) to Postgres. Not a port of any
// ord file — ord persists to redb tables directly from the updater; this is
// the equivalent boundary for our separate DB (D18).

import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import type { RuneEntry } from "../runes/entry.ts";
import { runeIdFromString } from "../runes/rune_id.ts";
import { spacedRuneToString } from "../runes/spaced_rune.ts";
import { type RuneState, createRuneState } from "../runes/state.ts";
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

/**
 * Flushes dirty entries/balances/events plus the block range
 * `[fromHeight, toHeight]`'s `btc_blocks` rows and the checkpoint, in one
 * transaction. Runs the supply invariant (over `state.dirtyRuneIds`) inside
 * the transaction before it commits — throwing rolls the whole flush back
 * (fail closed, per plan design). Clears the dirty sets/event buffer only
 * after a successful commit.
 */
export async function flush(
	db: Kysely<Database>,
	state: RuneState,
	blocks: Array<{ height: number; hash: string }>,
	checkInvariant: (state: RuneState, ruleIds: Iterable<string>) => void,
): Promise<void> {
	if (blocks.length === 0) {
		throw new Error("flush: no blocks to flush");
	}
	const last = blocks[blocks.length - 1] as { height: number; hash: string };

	await db.transaction().execute(async (trx) => {
		for (const ruleId of state.dirtyRuneIds) {
			const entry = state.entries.get(ruleId);
			if (!entry) continue; // shouldn't happen — checkInvariant below would catch it regardless

			const { block, tx } = runeIdFromString(ruleId);
			const spacedRune = spacedRuneToString({
				rune: { n: entry.rune },
				spacers: entry.spacers,
			});

			await trx
				.insertInto("rune_entries")
				.values({
					rune_id: ruleId,
					block: s(block),
					tx: s(tx),
					number: s(entry.number),
					rune: s(entry.rune),
					spaced_rune: spacedRune,
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
				})
				.onConflict((oc) =>
					oc.column("rune_id").doUpdateSet((eb) => ({
						mints: eb.ref("excluded.mints"),
						burned: eb.ref("excluded.burned"),
					})),
				)
				.execute();
		}

		// Delete-then-reinsert every dirty outpoint's balances — simple and
		// correct at this scale (see NOTES on flush design in the executor report).
		for (const outpoint of state.dirtyOutpoints) {
			const sep = outpoint.lastIndexOf(":");
			const txid = outpoint.slice(0, sep);
			const vout = Number(outpoint.slice(sep + 1));

			await trx
				.deleteFrom("rune_balances")
				.where("txid", "=", txid)
				.where("vout", "=", vout)
				.execute();

			const held = state.balances.get(outpoint);
			if (held && held.size > 0) {
				await trx
					.insertInto("rune_balances")
					.values(
						[...held.entries()].map(([ruleId, amount]) => ({
							txid,
							vout,
							rune_id: ruleId,
							amount: s(amount),
						})),
					)
					.execute();
			}
		}

		if (state.events.length > 0) {
			await trx
				.insertInto("rune_events")
				.values(
					state.events.map((event) => ({
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

	state.dirtyRuneIds.clear();
	state.dirtyOutpoints.clear();
	state.dirtySpentOutpoints.clear();
	state.events = [];
	state.height = last.height;
	state.hash = last.hash;
}
