import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import { STREAMS_BLOCKS_PER_DAY } from "../streams/tiers.ts";
import {
	type CanonicalRangeReader,
	getCanonicalResponse,
	readCanonicalRange,
} from "./canonical.ts";
import type { IndexTip } from "./tip.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const TIP: IndexTip = {
	block_height: 30_000,
	finalized_height: 29_994,
	lag_seconds: 3,
};

function params(query: string) {
	return new URL(`http://localhost/v1/index/canonical${query}`).searchParams;
}

const EMPTY_READER: CanonicalRangeReader = async () => ({
	canonical: [],
	next_cursor: null,
});

describe("Index canonical helpers", () => {
	test("defaults to last day when no explicit height or cursor is provided", async () => {
		const windows: Array<{ fromHeight: number; toHeight: number }> = [];
		await getCanonicalResponse({
			query: params(""),
			tip: TIP,
			readCanonical: async (p) => {
				windows.push({ fromHeight: p.fromHeight, toHeight: p.toHeight });
				return { canonical: [], next_cursor: null };
			},
		});
		expect(windows[0]).toEqual({
			fromHeight: Math.max(0, TIP.block_height - STREAMS_BLOCKS_PER_DAY),
			toHeight: TIP.block_height,
		});
	});

	test("passes the cursor through as an exclusive lower bound", async () => {
		const afters: Array<{ block_height: number } | undefined> = [];
		await getCanonicalResponse({
			query: params("?from_cursor=9000:0"),
			tip: TIP,
			readCanonical: async (p) => {
				afters.push(p.after);
				return { canonical: [], next_cursor: null };
			},
		});
		expect(afters[0]).toEqual({ block_height: 9000 });
	});

	test("a cursor past the tip returns empty and echoes the cursor", async () => {
		const response = await getCanonicalResponse({
			query: params("?from_cursor=40000:0"),
			tip: TIP,
			readCanonical: EMPTY_READER,
		});
		expect(response.canonical).toEqual([]);
		expect(response.next_cursor).toBe("40000:0");
	});
});

describe.skipIf(!HAS_DB)("Index canonical DB reads", () => {
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

	test("returns only canonical blocks, ordered by height", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("blocks")
			.values([
				block(9000, true),
				block(9001, false), // orphaned — must be excluded
				block(9002, true),
			])
			.execute();

		const result = await readCanonicalRange({
			db,
			fromHeight: 0,
			toHeight: 10_000,
			limit: 10,
		});

		expect(result.canonical.map((b) => b.block_height)).toEqual([9000, 9002]);
		expect(result.canonical[0]).toMatchObject({
			cursor: "9000:0",
			block_hash: "0x9000",
			parent_hash: "0x8999",
			burn_block_height: 19_000,
		});
		expect(result.next_cursor).toBe("9002:0");
	});

	test("cursor pagination returns heights after the cursor", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("blocks")
			.values([block(9000, true), block(9001, true), block(9002, true)])
			.execute();

		const result = await readCanonicalRange({
			db,
			after: { block_height: 9000 },
			fromHeight: 0,
			toHeight: 10_000,
			limit: 1,
		});

		expect(result.canonical.map((b) => b.block_height)).toEqual([9001]);
		expect(result.next_cursor).toBe("9001:0");
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
