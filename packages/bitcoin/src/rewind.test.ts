// DB-backed rewindTo tests. Skipped when BITCOIN_TEST_DATABASE_URL isn't set
// (the same convention as packages/stacks's nonceStores.test.ts) — run
// locally against a scratch database with:
//
//   BITCOIN_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5440/bitcoin_rewind_test \
//     bun test src/rewind.test.ts
//
// (create the scratch database first; this file migrates it and truncates
// between tests, but never creates/drops the database itself).
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { sql } from "kysely";
import type { Kysely } from "kysely";
import { migrateToLatest } from "./db/migrate.ts";
import { flush, loadState, openStore } from "./db/store.ts";
import type { Database } from "./db/types.ts";
import { computeStateHash } from "./integrity/digest.ts";
import { DeepReorgError, rewindTo } from "./rewind.ts";
import { checkInvariant } from "./runes/invariant.ts";
import {
	type RuneState,
	createRuneState,
	getBalance,
	seedGenesis,
	setBalance,
} from "./runes/state.ts";
import { snapshotState } from "./runes/undo.ts";

const testUrl = process.env.BITCOIN_TEST_DATABASE_URL;

function stateHash(state: RuneState): string {
	return bytesToHex(computeStateHash(state));
}

/** Applies one synthetic block (a mint, matching the invariant) and flushes it with undo tracking — the "at tip" pattern (flush.ts step 4). */
async function applyAndFlushBlock(
	db: Kysely<Database>,
	state: RuneState,
	height: number,
	runeId: string,
	mintAmount: bigint,
): Promise<void> {
	const before = snapshotState(state);
	const entry = state.entries.get(runeId);
	if (!entry) throw new Error(`no entry for ${runeId}`);
	entry.mints += 1n;
	state.dirtyRuneIds.add(runeId);
	const outpoint = `${height.toString(16).padStart(64, "0")}:0`;
	setBalance(
		state,
		outpoint,
		runeId,
		getBalance(state, outpoint, runeId) + mintAmount,
		"bc1qay6jxstdwyma44ak8qfu52njqy9ujnfm37hllg",
	);
	state.events.push({
		kind: "mint",
		height,
		txIndex: 0,
		txid: height.toString(16).padStart(64, "0"),
		runeId,
		amount: mintAmount,
	});
	await flush(
		db,
		state,
		[{ height, hash: `${height.toString(16).padStart(63, "0")}f` }],
		checkInvariant,
		{ undoSnapshotBeforeBlock: before },
	);
}

describe.skipIf(!testUrl)("rewindTo", () => {
	// biome-ignore lint/style/noNonNullAssertion: describe.skipIf(!testUrl) guards this whole block
	const db = openStore(testUrl!);

	beforeEach(async () => {
		process.env.BITCOIN_DATABASE_URL = testUrl;
		await migrateToLatest();
		// migrateToLatest only migrates up from whatever's already there; start
		// every test from a clean slate.
		await sql`truncate table rune_entries, rune_balances, rune_events, btc_blocks, runes_checkpoint, rune_block_digests, rune_undo, btc_reorgs`.execute(
			db,
		);
	});

	afterAll(async () => {
		await db.destroy();
	});

	test("rewinding 2 blocks matches a state that only ever saw the first block", async () => {
		const runeId = "1:0";

		const state = createRuneState();
		seedGenesis(state);
		await applyAndFlushBlock(db, state, 840_000, runeId, 1n);
		// Captured now, before blocks 840,001/840,002 mutate `state` further —
		// this is exactly the state a rewind back to 840,000 should reproduce.
		const referenceHash = stateHash(state);

		await applyAndFlushBlock(db, state, 840_001, runeId, 1n);
		await applyAndFlushBlock(db, state, 840_002, runeId, 1n);

		expect(state.height).toBe(840_002);

		await rewindTo(db, state, 840_000);

		expect(state.height).toBe(840_000);
		expect(stateHash(state)).toBe(referenceHash);

		// The DB agrees: reloading from Postgres matches too.
		const reloaded = await loadState(db);
		expect(reloaded.height).toBe(840_000);
		expect(stateHash(reloaded)).toBe(referenceHash);
	});

	test("writes exactly one btc_reorgs row describing the rewind", async () => {
		const runeId = "1:0";
		const state = createRuneState();
		seedGenesis(state);
		await applyAndFlushBlock(db, state, 840_000, runeId, 1n);
		await applyAndFlushBlock(db, state, 840_001, runeId, 1n);

		await rewindTo(db, state, 840_000);

		const rows = await db.selectFrom("btc_reorgs").selectAll().execute();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.fork_point_height).toBe(840_000);
		expect(rows[0]?.orphaned_from).toBe(840_001);
		expect(rows[0]?.orphaned_to).toBe(840_001);
		expect(rows[0]?.new_tip_height).toBe(840_000);
	});

	test("a rewind deeper than UNDO_DEPTH throws DeepReorgError and writes nothing", async () => {
		const runeId = "1:0";
		const state = createRuneState();
		seedGenesis(state);
		for (let h = 840_000; h <= 840_012; h++) {
			await applyAndFlushBlock(db, state, h, runeId, 1n);
		}
		expect(state.height).toBe(840_012); // 13 blocks applied (840,000..840,012)

		// 840_012 - 839_999 = 13 > UNDO_DEPTH (12).
		await expect(rewindTo(db, state, 839_999)).rejects.toBeInstanceOf(
			DeepReorgError,
		);

		// Nothing was written: checkpoint is untouched, no reorg row.
		const checkpoint = await db
			.selectFrom("runes_checkpoint")
			.selectAll()
			.executeTakeFirst();
		expect(checkpoint?.height).toBe(840_012);
		const reorgRows = await db.selectFrom("btc_reorgs").selectAll().execute();
		expect(reorgRows).toHaveLength(0);
		// state itself is untouched too (rewindTo returned before mutating it).
		expect(state.height).toBe(840_012);
	});

	test("restores an etched rune's entry entirely when its etching block is undone", async () => {
		const state = createRuneState();
		seedGenesis(state);
		await applyAndFlushBlock(db, state, 840_000, "1:0", 1n);

		// Block 840,001 etches a brand-new rune with a premine.
		const before = snapshotState(state);
		const newRuneId = "840001:0";
		state.entries.set(newRuneId, {
			block: 840_001n,
			burned: 0n,
			divisibility: 0,
			etching: "e".repeat(64),
			mints: 0n,
			number: 1n,
			premine: 500n,
			rune: 999_999n,
			spacers: 0,
			symbol: undefined,
			terms: undefined,
			timestamp: 1_700_000_100n,
			turbo: false,
		});
		state.runeToId.set("999999", newRuneId);
		state.statisticRunes += 1n;
		state.dirtyRuneIds.add(newRuneId);
		const outpoint = `${"1".repeat(64)}:0`;
		setBalance(state, outpoint, newRuneId, 500n);
		state.events.push({
			kind: "etch",
			height: 840_001,
			txIndex: 0,
			txid: "e".repeat(64),
			runeId: newRuneId,
		});
		await flush(
			db,
			state,
			[{ height: 840_001, hash: "f".repeat(64) }],
			checkInvariant,
			{ undoSnapshotBeforeBlock: before },
		);

		expect(state.entries.has(newRuneId)).toBe(true);

		await rewindTo(db, state, 840_000);

		expect(state.entries.has(newRuneId)).toBe(false);
		expect(state.runeToId.has("999999")).toBe(false);
		expect(state.balances.has(outpoint)).toBe(false);

		const dbEntry = await db
			.selectFrom("rune_entries")
			.selectAll()
			.where("rune_id", "=", newRuneId)
			.executeTakeFirst();
		expect(dbEntry).toBeUndefined();
	});
});
