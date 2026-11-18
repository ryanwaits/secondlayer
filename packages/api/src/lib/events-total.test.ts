import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getSourceDb } from "@secondlayer/shared/db";
import { sql } from "kysely";
import {
	type EventsTotalBounds,
	type EventsTotalStore,
	type SavedBaseline,
	countCanonicalEvents,
	createEventsTotalCounter,
	postgresEventsTotalStore,
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

/** In-memory store. `claimRebaseline` grants the claim once until `save`. */
function memoryStore(saved: SavedBaseline | null = null, claimable = true) {
	const store = {
		saved,
		claimed: false,
		claims: 0,
		extends: 0,
		claimRebaseline: async () => {
			store.claims++;
			if (!claimable || store.claimed) return false;
			store.claimed = true;
			return true;
		},
		load: async () => store.saved,
		save: async (b: SavedBaseline) => {
			store.saved = b;
			store.claimed = false;
		},
		extend: async (through: number, count: number) => {
			store.extends++;
			if (store.saved && through > store.saved.through) {
				store.saved = { ...store.saved, through, count };
			}
		},
	} satisfies EventsTotalStore & Record<string, unknown>;
	return store;
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

	test("a new process adopts a saved baseline and counts only above it", async () => {
		const chain = fakeChain(Array.from({ length: 20 }, (_, h) => h + 1));
		const store = memoryStore({
			through: 5,
			count: sum(chain.perHeight.slice(0, 6)),
			takenAt: 0,
		});
		const counter = createEventsTotalCounter({
			readBounds: async () => ({ tip: 10, finalized: 8 }),
			countRange: chain.countRange,
			now: () => 1000,
			store,
		});
		await counter.refresh();
		expect(counter.read()).toBe(sum(chain.perHeight.slice(0, 11)));
		expect(chain.calls.every(([from]) => from > 0)).toBe(true);
	});

	test("only the claim winner recounts; a loser with no saved baseline serves null", async () => {
		const store = memoryStore();
		const chainA = fakeChain([1, 2, 3, 4, 5, 6]);
		const countA = chainA.countRange;
		chainA.countRange = async (from, to) => {
			await Bun.sleep(20);
			return countA(from, to);
		};
		const chainB = fakeChain([1, 2, 3, 4, 5, 6]);
		const make = (chain: ReturnType<typeof fakeChain>) =>
			createEventsTotalCounter({
				readBounds: async () => ({ tip: 5, finalized: 3 }),
				countRange: chain.countRange,
				store,
			});
		const a = make(chainA);
		const b = make(chainB);

		// B refreshes while A is still mid-recount, so nothing is saved yet.
		const aRefresh = a.refresh();
		await Bun.sleep(0);
		await b.refresh();
		expect(b.read()).toBeNull();
		expect(chainB.calls).toEqual([]);

		await aRefresh;
		expect(a.read()).toBe(21);
		expect(chainA.calls.some(([from]) => from === 0)).toBe(true);

		await b.refresh();
		expect(b.read()).toBe(21);
		expect(chainB.calls.every(([from]) => from > 0)).toBe(true);
	});

	test("a stale saved baseline is recounted by the claim winner and published", async () => {
		const rebaselineMs = 1_000;
		const chain = fakeChain([1, 1, 1, 1, 1, 1]);
		const store = memoryStore({ through: 2, count: 3, takenAt: 0 });
		const counter = createEventsTotalCounter({
			readBounds: async () => ({ tip: 5, finalized: 3 }),
			countRange: chain.countRange,
			now: () => rebaselineMs,
			rebaselineMs,
			store,
		});
		await counter.refresh();
		expect(chain.calls.some(([from]) => from === 0)).toBe(true);
		expect(store.saved?.takenAt).toBe(rebaselineMs);
		expect(store.saved?.through).toBe(3);
		expect(counter.read()).toBe(6);
	});

	test("an extension is published so the next process starts higher", async () => {
		let bounds: EventsTotalBounds = { tip: 10, finalized: 8 };
		const chain = fakeChain(Array.from({ length: 20 }, () => 1));
		const store = memoryStore({ through: 5, count: 6, takenAt: 0 });
		const counter = createEventsTotalCounter({
			readBounds: async () => bounds,
			countRange: chain.countRange,
			now: () => 1000,
			store,
		});
		await counter.refresh();
		expect(store.saved?.through).toBe(8);
		bounds = { tip: 12, finalized: 9 };
		await counter.refresh();
		expect(store.saved?.through).toBe(9);
		expect(store.saved?.count).toBe(10);
	});

	test("a saved baseline ahead of this process's chain view is not used", async () => {
		const chain = fakeChain([1, 1, 1]);
		const store = memoryStore({ through: 50, count: 51, takenAt: 0 }, false);
		const counter = createEventsTotalCounter({
			readBounds: async () => ({ tip: 10, finalized: 8 }),
			countRange: chain.countRange,
			now: () => 1000,
			store,
		});
		await counter.refresh();
		expect(counter.read()).toBeNull();
		expect(chain.calls).toEqual([]);
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

describe.skipIf(!HAS_DB)("postgresEventsTotalStore", () => {
	const db = HAS_DB ? getSourceDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM events_total_baseline`.execute(db);
	});

	test("claim is exclusive until saved or expired", async () => {
		const a = postgresEventsTotalStore();
		const b = postgresEventsTotalStore();
		expect(await a.claimRebaseline()).toBe(true);
		expect(await b.claimRebaseline()).toBe(false);

		await a.save({ through: 3, count: 7, takenAt: Date.now() });
		const loaded = await b.load();
		expect(loaded?.through).toBe(3);
		expect(loaded?.count).toBe(7);
		expect(Math.abs((loaded?.takenAt ?? 0) - Date.now())).toBeLessThan(2_000);
		expect(await b.claimRebaseline()).toBe(true);

		const quick = postgresEventsTotalStore(undefined, 1);
		await Bun.sleep(5);
		expect(await quick.claimRebaseline()).toBe(true);
	});

	test("extend only moves forward", async () => {
		const store = postgresEventsTotalStore();
		await store.claimRebaseline();
		await store.save({ through: 3, count: 7, takenAt: Date.now() });
		await store.extend(2, 1);
		expect((await store.load())?.through).toBe(3);
		await store.extend(5, 9);
		const loaded = await store.load();
		expect(loaded?.through).toBe(5);
		expect(loaded?.count).toBe(9);
	});
});
