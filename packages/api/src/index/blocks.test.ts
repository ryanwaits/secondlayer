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
});

describe.skipIf(!HAS_DB)("Index blocks DB reads", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
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
