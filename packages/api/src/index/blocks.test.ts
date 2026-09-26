import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import { STREAMS_BLOCKS_PER_DAY } from "../streams/tiers.ts";
import {
	type BlocksReader,
	getBlocksResponse,
	readBlockByRef,
	readBlocks,
} from "./blocks.ts";
import type { IndexTip } from "./tip.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const TIP: IndexTip = {
	block_height: 30_000,
	finalized_height: 29_994,
	lag_seconds: 3,
};

function params(query: string) {
	return new URL(`http://localhost/v1/index/blocks${query}`).searchParams;
}

const EMPTY_READER: BlocksReader = async () => ({
	blocks: [],
	next_cursor: null,
});

describe("Index blocks helpers", () => {
	test("defaults to last day when no explicit height or cursor is provided", async () => {
		const windows: Array<{ fromHeight: number; toHeight: number }> = [];
		await getBlocksResponse({
			query: params(""),
			tip: TIP,
			readBlocks: async (p) => {
				windows.push({ fromHeight: p.fromHeight, toHeight: p.toHeight });
				return { blocks: [], next_cursor: null };
			},
		});
		expect(windows[0]).toEqual({
			fromHeight: Math.max(0, TIP.block_height - STREAMS_BLOCKS_PER_DAY),
			toHeight: TIP.block_height,
		});
	});

	test("a cursor past the tip returns empty and echoes the cursor", async () => {
		const response = await getBlocksResponse({
			query: params("?from_cursor=40000:0"),
			tip: TIP,
			readBlocks: EMPTY_READER,
		});
		expect(response.blocks).toEqual([]);
		expect(response.next_cursor).toBe("40000:0");
	});

	test("windows clamp to source_block_height; envelope tip stays decoded", async () => {
		const lagged: IndexTip = {
			block_height: 100,
			finalized_height: 90,
			lag_seconds: 0,
			source_block_height: 200,
		};
		let seenTo: number | undefined;
		const response = await getBlocksResponse({
			query: params("?from_cursor=150:0"),
			tip: lagged,
			readBlocks: async (p) => {
				seenTo = p.toHeight;
				return {
					blocks: [
						{
							cursor: "150:0",
							block_height: 150,
							block_hash: "0x150",
							parent_hash: "0x149",
							burn_block_height: 1,
							burn_block_hash: null,
							index_block_hash: null,
							block_time: null,
							canonical: true,
						},
					],
					next_cursor: "150:0",
				};
			},
		});
		expect(seenTo).toBe(200);
		expect(response.tip.block_height).toBe(100);
		expect(response.blocks).toHaveLength(1);
	});

	test("tip_only skips the row query entirely and always reports blocks: []", async () => {
		let readerCalled = false;
		const response = await getBlocksResponse({
			query: params("?tip_only=true&from_height=1&wait=5"),
			tip: TIP,
			readBlocks: async () => {
				readerCalled = true;
				return { blocks: [{} as never], next_cursor: "x" };
			},
		});
		expect(readerCalled).toBe(false);
		expect(response).toEqual({ blocks: [], next_cursor: null, tip: TIP });
	});

	test("tip_only reproduces plan-063's regression: a decoded-tip caller must NOT see rows just because the source tip (which readBlocks windows to) is ahead of the decoded tip it's tracking", async () => {
		// Same lag shape as the test above (decoded 100, source 200) — a
		// non-tip_only /blocks read legitimately serves real rows there. A
		// tip_only caller (IndexHttpClient.getIndexTip's wait) must see
		// blocks: [] regardless, because it doesn't want rows — it wants to
		// know whether the DECODED tip moved, which readBlocks' source-tip
		// window cannot answer.
		const lagged: IndexTip = {
			block_height: 100,
			finalized_height: 90,
			lag_seconds: 0,
			source_block_height: 200,
		};
		let readerCalled = false;
		const response = await getBlocksResponse({
			query: params("?tip_only=true&from_height=101"),
			tip: lagged,
			readBlocks: async () => {
				readerCalled = true;
				return { blocks: [{} as never], next_cursor: "x" };
			},
		});
		expect(readerCalled).toBe(false);
		expect(response.blocks).toEqual([]);
		expect(response.tip.block_height).toBe(100);
	});

	test("tip_only + event_types narrows to the MIN committed height over just those types, not the global cross-decoder floor", async () => {
		// referenced=100 is way ahead; unreferenced=91 is the current global
		// bottleneck. A caller scoped to `referenced` must see 100 (its own
		// decoder's progress), not 91 (an irrelevant decoder dragging the
		// global floor down) or the reverse (an irrelevant decoder racing
		// ahead must not matter either).
		const tip: IndexTip = {
			block_height: 91, // global min(referenced=100, unreferenced=91)
			finalized_height: 90,
			lag_seconds: 0,
			decoded_heights: { referenced: 100, unreferenced: 91 },
		};
		const response = await getBlocksResponse({
			query: params("?tip_only=true&event_types=referenced&from_height=101"),
			tip,
		});
		expect(response.tip.block_height).toBe(100);
	});

	test("regression: this is what plan-063's busy-idle pattern actually was — an UNREFERENCED decoder committing repeatedly must never flip an unrelated wait to non-empty", async () => {
		// The evaluator's baseline (`from_height`) is one past what it last saw
		// for `referenced` specifically (100) — it has NOT changed. Only the
		// unreferenced decoder is advancing (91 → 92 → …), which without
		// `event_types` moves the global floor and would report "new data".
		const referencedFixed = 100;
		const fromHeight = referencedFixed + 1;
		for (const unreferencedNow of [91, 95, 99, 100, 105]) {
			const tip: IndexTip = {
				block_height: Math.min(referencedFixed, unreferencedNow),
				finalized_height: 90,
				lag_seconds: 0,
				decoded_heights: {
					referenced: referencedFixed,
					unreferenced: unreferencedNow,
				},
			};
			const response = await getBlocksResponse({
				query: params(
					`?tip_only=true&event_types=referenced&from_height=${fromHeight}`,
				),
				tip,
			});
			// Still exactly `referencedFixed` — the router's isEmpty (`tip.block_height
			// <= knownHeight`) stays true (still empty, wait holds) for every one of
			// these unreferenced-only advances.
			expect(response.tip.block_height).toBe(referencedFixed);
		}

		// Now the referenced decoder itself commits — THIS is what should
		// unblock the wait.
		const tip: IndexTip = {
			block_height: referencedFixed, // unreferenced (105) no longer the min
			finalized_height: 90,
			lag_seconds: 0,
			decoded_heights: { referenced: 105, unreferenced: 105 },
		};
		const response = await getBlocksResponse({
			query: params(
				`?tip_only=true&event_types=referenced&from_height=${fromHeight}`,
			),
			tip,
		});
		expect(response.tip.block_height).toBe(105);
	});

	test("tip_only + event_types falls back to the global floor when the type is unknown to decoded_heights (older server, or a typo)", async () => {
		const tip: IndexTip = {
			block_height: 42,
			finalized_height: 40,
			lag_seconds: 0,
			decoded_heights: { ft_transfer: 42 },
		};
		const response = await getBlocksResponse({
			query: params("?tip_only=true&event_types=made_up_type&from_height=1"),
			tip,
		});
		expect(response.tip.block_height).toBe(42);
	});
});

describe.skipIf(!HAS_DB)("Index blocks DB reads", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		// Clear the full FK chain first: leftover rows from sibling suites
		// (events → transactions → blocks) would otherwise violate FKs on delete.
		await sql`DELETE FROM events`.execute(db);
		await sql`DELETE FROM decoded_events`.execute(db);
		await sql`DELETE FROM transactions`.execute(db);
		await sql`DELETE FROM blocks`.execute(db);
	});

	test("lists only canonical blocks, ordered, with block_time", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("blocks")
			.values([block(9000, true), block(9001, false), block(9002, true)])
			.execute();

		const result = await readBlocks({
			db,
			fromHeight: 0,
			toHeight: 10_000,
			limit: 10,
		});

		expect(result.blocks.map((b) => b.block_height)).toEqual([9000, 9002]);
		expect(result.blocks[0]).toMatchObject({
			cursor: "9000:0",
			block_hash: "0x9000",
			parent_hash: "0x8999",
			canonical: true,
		});
		expect(result.blocks[0]?.block_time).not.toBeNull();
		expect(result.next_cursor).toBe("9002:0");
	});

	test("fetches a block by height (canonical only)", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("blocks")
			.values([block(9000, true)])
			.execute();
		const found = await readBlockByRef("9000", db);
		expect(found?.block_hash).toBe("0x9000");
		const missing = await readBlockByRef("9999", db);
		expect(missing).toBeNull();
	});

	test("fetches a block by hash, surfacing an orphaned block's canonical flag", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("blocks")
			.values([block(9001, false)])
			.execute();
		const found = await readBlockByRef("0x9001", db);
		expect(found?.block_height).toBe(9001);
		expect(found?.canonical).toBe(false);
	});
});

function block(height: number, canonical: boolean) {
	return {
		height,
		hash: `0x${height}`,
		parent_hash: `0x${height - 1}`,
		burn_block_height: height + 10_000,
		burn_block_hash: `0xb${height}`,
		timestamp: 1_700_000_000 + height,
		canonical,
	};
}
