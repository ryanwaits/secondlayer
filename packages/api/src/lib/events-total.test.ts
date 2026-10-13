import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getSourceDb } from "@secondlayer/shared/db";
import { sql } from "kysely";
import {
	type EventsTotalBounds,
	countCanonicalEvents,
	createEventsTotalCounter,
} from "./events-total.ts";

/** Fake chain: `perHeight[h]` canonical events at height h. Records every
 *  counted range so tests can assert the request path never rescans history. */
function fakeChain(perHeight: number[]) {
	const calls: Array<[number, number]> = [];
	return {
		calls,
		perHeight,
		countRange: async (from: number, to: number) => {
			calls.push([from, to]);
			let n = 0;
			for (let h = from; h <= to && h < perHeight.length; h++) {
				n += perHeight[h] ?? 0;
			}
			return n;
		},
	};
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("events total counter", () => {
	test("read never blocks: null until the first count, then the exact total", async () => {
		const chain = fakeChain([1, 2, 3, 4, 5]);
		const counter = createEventsTotalCounter({
			readBounds: async () => ({ tip: 4, finalized: 2 }),
			countRange: chain.countRange,
		});

		expect(counter.read()).toBeNull();
		await counter.refresh();
		expect(counter.read()).toBe(15);
	});

	test("after the baseline, a refresh counts only new finalized heights plus the unfinalized tail", async () => {
		let now = 0;
		let bounds: EventsTotalBounds = { tip: 10, finalized: 5 };
		const chain = fakeChain(Array.from({ length: 30 }, (_, h) => h % 3));
		const counter = createEventsTotalCounter({
			readBounds: async () => bounds,
			countRange: chain.countRange,
			now: () => now,
			chunkBlocks: 4,
		});

		await counter.refresh();
		expect(counter.read()).toBe(sum(chain.perHeight.slice(0, 11)));
		// Baseline chunked by 4 heights, then the tail.
		expect(chain.calls).toEqual([
			[0, 3],
			[4, 5],
			[6, 10],
		]);

		chain.calls.length = 0;
		now += 10_000;
		bounds = { tip: 20, finalized: 12 };
		await counter.refresh();
		expect(counter.read()).toBe(sum(chain.perHeight.slice(0, 21)));
		expect(chain.calls).toEqual([
			[6, 9],
			[10, 12],
			[13, 20],
		]);
	});

	test("a reorg inside the unfinalized tail is reflected on the next refresh", async () => {
		const chain = fakeChain([5, 5, 5, 5]);
		const counter = createEventsTotalCounter({
			readBounds: async () => ({ tip: 3, finalized: 1 }),
			countRange: chain.countRange,
		});
		await counter.refresh();
		expect(counter.read()).toBe(20);

		chain.perHeight[3] = 1; // height 3 replaced by a smaller fork block
		await counter.refresh();
		expect(counter.read()).toBe(16);
	});

	test("the baseline is fully recounted after rebaselineMs, picking up repairs below finality", async () => {
		let now = 0;
		const chain = fakeChain([5, 5, 5]);
		const counter = createEventsTotalCounter({
			readBounds: async () => ({ tip: 2, finalized: 2 }),
			countRange: chain.countRange,
			now: () => now,
			rebaselineMs: 1_000,
		});
		await counter.refresh();
		chain.perHeight[0] = 9; // operator repair restored rows at height 0

		now = 500;
		await counter.refresh();
		expect(counter.read()).toBe(15);

		now = 1_000;
		await counter.refresh();
		expect(counter.read()).toBe(19);
	});

	test("concurrent refreshes share one in-flight count", async () => {
		const chain = fakeChain([1, 1]);
		const counter = createEventsTotalCounter({
			readBounds: async () => ({ tip: 1, finalized: 1 }),
			countRange: chain.countRange,
		});
		await Promise.all([
			counter.refresh(),
			counter.refresh(),
			counter.refresh(),
		]);
		expect(chain.calls).toHaveLength(1);
		expect(counter.read()).toBe(2);
	});

	test("read only triggers a refresh once refreshMs has elapsed", async () => {
		let now = 0;
		let boundsReads = 0;
		const counter = createEventsTotalCounter({
			readBounds: async () => {
				boundsReads++;
				return { tip: 0, finalized: 0 };
			},
			countRange: async () => 7,
			now: () => now,
			refreshMs: 10_000,
		});
		await counter.refresh();
		expect(boundsReads).toBe(1);

		now = 9_999;
		counter.read();
		expect(boundsReads).toBe(1);

		now = 10_000;
		counter.read();
		expect(boundsReads).toBe(2);
	});

	test("an install with no canonical blocks reports 0", async () => {
		const counter = createEventsTotalCounter({
			readBounds: async () => null,
			countRange: async () => {
				throw new Error("must not count without blocks");
			},
		});
		await counter.refresh();
		expect(counter.read()).toBe(0);
	});

	test("a failed refresh keeps serving the last good value", async () => {
		let fail = false;
		const counter = createEventsTotalCounter({
			readBounds: async () => {
				if (fail) throw new Error("db down");
				return { tip: 0, finalized: 0 };
			},
			countRange: async () => 3,
		});
		await counter.refresh();
		fail = true;
		await expect(counter.refresh()).rejects.toThrow("db down");
		expect(counter.read()).toBe(3);
	});
});

const HAS_DB = !!process.env.DATABASE_URL;
const H = 993_100;
const TO = H + 2;

// Must match the archive's `events` dataset: only rows in canonical blocks.
describe.skipIf(!HAS_DB)("countCanonicalEvents", () => {
	const db = HAS_DB ? getSourceDb() : null;

	async function clean() {
		if (!db) return;
		await sql`DELETE FROM events WHERE block_height BETWEEN ${H} AND ${TO}`.execute(
			db,
		);
		await sql`DELETE FROM transactions WHERE block_height BETWEEN ${H} AND ${TO}`.execute(
			db,
		);
		await sql`DELETE FROM blocks WHERE height BETWEEN ${H} AND ${TO}`.execute(
			db,
		);
	}

	beforeEach(async () => {
		if (!db) return;
		await clean();
		for (let i = 0; i <= 2; i++) {
			const height = H + i;
			await db
				.insertInto("blocks")
				.values({
					height,
					hash: `0xet${height}`,
					parent_hash: `0xet${height - 1}`,
					burn_block_height: height,
					burn_block_hash: "0xburn",
					index_block_hash: null,
					timestamp: 1_700_000_000 + i,
					// The middle block is orphaned.
					canonical: i !== 1,
				})
				.execute();
			await db
				.insertInto("transactions")
				.values({
					tx_id: `0xettx${height}`,
					block_height: height,
					tx_index: 0,
					type: "contract_call",
					sender: "SP1",
					status: "success",
					contract_id: "SP1.c",
					function_name: "f",
					raw_tx: "0x00",
				})
				.execute();
			await db
				.insertInto("events")
				.values(
					[0, 1].map((event_index) => ({
						tx_id: `0xettx${height}`,
						block_height: height,
						event_index,
						type: "contract_event",
						data: { i: event_index },
					})),
				)
				.execute();
		}
	});

	afterAll(clean);

	test("counts events in canonical blocks only, bounds inclusive", async () => {
		expect(await countCanonicalEvents(H, TO, db ?? undefined)).toBe(4);
		expect(await countCanonicalEvents(H, H, db ?? undefined)).toBe(2);
		expect(await countCanonicalEvents(H + 1, H + 1, db ?? undefined)).toBe(0);
	});
});
