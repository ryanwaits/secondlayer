/**
 * Seed → reorg → replay: supply conservation + cursor monotonicity
 *
 * Asserts the end-to-end invariant that:
 *   (a) After seeding blocks 1–5, rewinding at height 3, then replaying 3–5
 *       on a new fork, Σ amount over canonical rows == prefix supply (blocks 1–2)
 *       + new-fork supply (blocks 3–5). Zero contribution from deleted old fork.
 *   (b) Cursors are strictly increasing and unique both before and after reorg+replay.
 *
 * No production source files are modified.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import { handleDecodedEventsReorg, writeDecodedEvents } from "./storage.ts";

const HAS_DB = !!process.env.DATABASE_URL;

function ftEvent(opts: {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	amount: number;
}) {
	return {
		cursor: opts.cursor,
		block_height: opts.block_height,
		tx_id: opts.tx_id,
		tx_index: opts.tx_index,
		event_index: opts.event_index,
		event_type: "ft_transfer" as const,
		decoded_payload: {
			contract_id: "SP1.token",
			asset_identifier: "SP1.token::token",
			token_name: "token",
			sender: "SP1",
			recipient: "SP2",
			amount: String(opts.amount),
		},
		source_cursor: opts.cursor,
	};
}

describe.skipIf(!HAS_DB)(
	"reorg→replay: supply conservation + cursor monotonicity",
	() => {
		const db = HAS_DB ? getDb() : null;

		async function cleanup() {
			if (!db) return;
			// Full table wipe mirrors the model test's beforeEach and avoids
			// residue from other test runs at overlapping block heights.
			await sql`DELETE FROM decoded_events`.execute(db);
			await sql`DELETE FROM l2_decoder_checkpoints`.execute(db);
		}

		beforeEach(cleanup);
		afterAll(cleanup);

		test("supply conserved and cursors monotonic after seed→reorg→replay", async () => {
			if (!db) throw new Error("missing db");

			// ─── Phase 1: Seed original fork, blocks 1–5 ─────────────────────────
			// Amounts chosen so each block has a distinct total; block 1 = 10, 2 = 20,
			// 3 = 30, 4 = 40, 5 = 50 (old fork — will be deleted by reorg at height 3).
			await writeDecodedEvents(
				[
					ftEvent({
						cursor: "1:0",
						block_height: 1,
						tx_id: "tx-1-0",
						tx_index: 0,
						event_index: 0,
						amount: 10,
					}),
					ftEvent({
						cursor: "2:0",
						block_height: 2,
						tx_id: "tx-2-0",
						tx_index: 0,
						event_index: 0,
						amount: 20,
					}),
					ftEvent({
						cursor: "3:0",
						block_height: 3,
						tx_id: "tx-3-0-old",
						tx_index: 0,
						event_index: 0,
						amount: 30,
					}),
					ftEvent({
						cursor: "4:0",
						block_height: 4,
						tx_id: "tx-4-0-old",
						tx_index: 0,
						event_index: 0,
						amount: 40,
					}),
					ftEvent({
						cursor: "5:0",
						block_height: 5,
						tx_id: "tx-5-0-old",
						tx_index: 0,
						event_index: 0,
						amount: 50,
					}),
				],
				{ db },
			);

			const prefixSupply = 10 + 20; // blocks 1–2 survive the reorg
			const oldForkSupply = 30 + 40 + 50; // blocks 3–5 old fork — must vanish

			// ─── Phase 2: Assert cursors strictly increasing + unique (pre-reorg) ──
			const preReorgCursors = await db
				.selectFrom("decoded_events")
				.select("cursor")
				.orderBy("block_height", "asc")
				.orderBy("event_index", "asc")
				.execute();

			const preReorgCursorList = preReorgCursors.map((r) => r.cursor);
			expect(preReorgCursorList).toHaveLength(5);

			// Unique — set size must equal array length.
			expect(new Set(preReorgCursorList).size).toBe(preReorgCursorList.length);

			// Strictly increasing: each cursor > previous (lexicographic; block-height
			// prefix ensures numeric order for our single-digit heights).
			for (let i = 1; i < preReorgCursorList.length; i++) {
				expect(preReorgCursorList[i] > preReorgCursorList[i - 1]).toBe(true);
			}

			// ─── Phase 3: Reorg at height 3 ──────────────────────────────────────
			const reorgResult = await handleDecodedEventsReorg(3, { db });

			// Deleted == 3 rows (heights 3, 4, 5).
			expect(reorgResult.deleted).toBe(3);

			// Only blocks 1 + 2 remain.
			const postReorgRows = await db
				.selectFrom("decoded_events")
				.select(["cursor", "block_height", "canonical", "amount"])
				.orderBy("block_height", "asc")
				.execute();
			expect(postReorgRows).toHaveLength(2);
			expect(postReorgRows.every((r) => r.block_height < 3)).toBe(true);
			expect(postReorgRows.every((r) => r.canonical)).toBe(true);

			// No orphan old-fork rows at heights >= 3.
			const orphans = await db
				.selectFrom("decoded_events")
				.select("cursor")
				.where("block_height", ">=", 3)
				.execute();
			expect(orphans).toHaveLength(0);

			// ─── Phase 4: Replay new fork for blocks 3–5 ─────────────────────────
			// Different tx_ids + amounts to distinguish from old fork.
			const newForkAmounts = { b3: 300, b4: 400, b5: 500 };
			await writeDecodedEvents(
				[
					ftEvent({
						cursor: "3:0",
						block_height: 3,
						tx_id: "tx-3-0-new",
						tx_index: 0,
						event_index: 0,
						amount: newForkAmounts.b3,
					}),
					ftEvent({
						cursor: "4:0",
						block_height: 4,
						tx_id: "tx-4-0-new",
						tx_index: 0,
						event_index: 0,
						amount: newForkAmounts.b4,
					}),
					ftEvent({
						cursor: "5:0",
						block_height: 5,
						tx_id: "tx-5-0-new",
						tx_index: 0,
						event_index: 0,
						amount: newForkAmounts.b5,
					}),
				],
				{ db },
			);

			const newForkSupply =
				newForkAmounts.b3 + newForkAmounts.b4 + newForkAmounts.b5;
			const expectedTotal = prefixSupply + newForkSupply;

			// ─── Phase 5: Supply conservation ─────────────────────────────────────
			const allRows = await db
				.selectFrom("decoded_events")
				.select(["cursor", "block_height", "canonical", "amount", "tx_id"])
				.orderBy("block_height", "asc")
				.orderBy("event_index", "asc")
				.execute();

			// Exactly 5 rows (2 prefix + 3 new-fork). No doubles.
			expect(allRows).toHaveLength(5);
			expect(allRows.every((r) => r.canonical)).toBe(true);

			// All amount rows numeric, none null.
			const amounts = allRows.map((r) => {
				expect(r.amount).not.toBeNull();
				return Number(r.amount);
			});
			const actualTotal = amounts.reduce((a, b) => a + b, 0);
			expect(actualTotal).toBe(expectedTotal);

			// Old-fork amounts must not appear: if they did the old rows survived.
			expect(actualTotal).not.toBe(prefixSupply + oldForkSupply);

			// New-fork tx_ids present, old-fork tx_ids absent for heights >= 3.
			const gte3Rows = allRows.filter((r) => r.block_height >= 3);
			for (const r of gte3Rows) {
				expect(r.tx_id).toMatch(/-new$/);
			}

			// ─── Phase 6: Cursor monotonicity after replay ────────────────────────
			const postCursors = allRows.map((r) => r.cursor);
			expect(new Set(postCursors).size).toBe(postCursors.length);

			for (let i = 1; i < postCursors.length; i++) {
				expect(postCursors[i] > postCursors[i - 1]).toBe(true);
			}
		});
	},
);
