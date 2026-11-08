import { describe, expect, test } from "bun:test";
import { applyReorgs, consumeStreamsEvents } from "./consumer.ts";
import type { StreamsEventsEnvelope } from "./types.ts";

function emptyEnvelope(tipHeight: number): StreamsEventsEnvelope {
	return {
		events: [],
		next_cursor: null,
		tip: {
			block_height: tipHeight,
			block_hash: "0x0",
			burn_block_height: 0,
			finalized_height: 0,
			lag_seconds: 0,
		},
		reorgs: [],
	};
}

describe("consumeStreamsEvents empty-poll wake", () => {
	test("a wake source that's already ready lets the loop skip a long backoff entirely", async () => {
		const start = Date.now();
		const result = await consumeStreamsEvents({
			fetchEvents: async () => emptyEnvelope(10),
			batchSize: 10,
			emptyBackoffMs: 60_000,
			maxPages: 3,
			wake: async () => {},
			onBatch: () => undefined,
		});
		expect(result.pages).toBe(3);
		expect(Date.now() - start).toBeLessThan(2_000);
	});

	test("without `wake`, an empty page still waits out the full backoff (unchanged fallback)", async () => {
		const start = Date.now();
		const result = await consumeStreamsEvents({
			fetchEvents: async () => emptyEnvelope(10),
			batchSize: 10,
			emptyBackoffMs: 50,
			maxPages: 2,
			onBatch: () => undefined,
		});
		expect(result.pages).toBe(2);
		expect(Date.now() - start).toBeGreaterThanOrEqual(45);
	});

	test("a wake source that rejects (e.g. a dropped LISTEN connection) degrades to the backoff timer instead of crashing the loop", async () => {
		const start = Date.now();
		const result = await consumeStreamsEvents({
			fetchEvents: async () => emptyEnvelope(10),
			batchSize: 10,
			emptyBackoffMs: 50,
			maxPages: 2,
			wake: async () => {
				throw new Error("listen connection dropped");
			},
			onBatch: () => undefined,
		});
		expect(result.pages).toBe(2);
		expect(Date.now() - start).toBeGreaterThanOrEqual(45);
	});

	test("a wake that never resolves never blocks progress past the backoff", async () => {
		const start = Date.now();
		const result = await consumeStreamsEvents({
			fetchEvents: async () => emptyEnvelope(10),
			batchSize: 10,
			emptyBackoffMs: 40,
			maxPages: 2,
			wake: () => new Promise<void>(() => {}),
			onBatch: () => undefined,
		});
		expect(result.pages).toBe(2);
		const elapsed = Date.now() - start;
		expect(elapsed).toBeGreaterThanOrEqual(35);
		expect(elapsed).toBeLessThan(2_000);
	});
});

function eventsAt(...cursors: string[]): StreamsEventsEnvelope["events"] {
	return cursors.map((cursor) => ({
		cursor,
		block_height: Number(cursor.replace(/^[a-z]+:/, "").split(":")[0]),
	})) as StreamsEventsEnvelope["events"];
}

function pageOf(
	events: StreamsEventsEnvelope["events"],
	next_cursor: string | null,
): StreamsEventsEnvelope {
	return { ...emptyEnvelope(100), events, next_cursor };
}

const codeOf = async (run: () => Promise<unknown>) =>
	(await run().then(
		() => null,
		(e: unknown) => e,
	)) as { code?: string } | null;

describe("consumeStreamsEvents cursor safety", () => {
	test("a page of events that leaves the cursor where it was throws CURSOR_STALLED", async () => {
		const err = await codeOf(() =>
			consumeStreamsEvents({
				fromCursor: "5:0",
				fetchEvents: async () => pageOf(eventsAt("5:0"), "5:0"),
				batchSize: 10,
				onBatch: () => undefined,
			}),
		);
		expect(err?.code).toBe("CURSOR_STALLED");
	});

	test("a stall on the last allowed page is the bound, not an error", async () => {
		const result = await consumeStreamsEvents({
			fromCursor: "5:0",
			fetchEvents: async () => pageOf(eventsAt("5:0"), "5:0"),
			batchSize: 10,
			maxPages: 1,
			onBatch: () => undefined,
		});
		expect(result.pages).toBe(1);
	});

	test("a next_cursor behind the cursor it was read from throws CURSOR_REGRESSED", async () => {
		const err = await codeOf(() =>
			consumeStreamsEvents({
				fromCursor: "9:0",
				fetchEvents: async () => pageOf(eventsAt("5:0"), "5:0"),
				batchSize: 10,
				onBatch: () => undefined,
			}),
		);
		expect(err?.code).toBe("CURSOR_REGRESSED");
	});

	test("tagged cursors compare by position, so a forward bitcoin page is fine", async () => {
		let calls = 0;
		const seen: (string | null | undefined)[] = [];
		await consumeStreamsEvents({
			fromCursor: "btc:9:0",
			mode: "bounded",
			fetchEvents: async ({ cursor }) => {
				seen.push(cursor);
				calls++;
				return calls === 1
					? pageOf(eventsAt("btc:10:0"), "btc:10:0")
					: pageOf([], "btc:10:0");
			},
			batchSize: 10,
			onBatch: () => undefined,
		});
		expect(seen).toEqual(["btc:9:0", "btc:10:0"]);
	});
});

describe("applyReorgs", () => {
	const reorg = { fork_point_height: 5 };
	const run = (cursor: string | null) => {
		const rolledBack: number[] = [];
		return applyReorgs({
			reorgs: [reorg],
			cursor,
			handled: new Set<string>(),
			keyOf: () => "r",
			onReorg: (r) => {
				rolledBack.push(r.fork_point_height);
			},
		}).then((rewind) => ({ rewind, rolledBack }));
	};

	test("rewinds a tagged bitcoin cursor like a bare one", async () => {
		const { rewind, rolledBack } = await run("btc:10:2");
		expect(rewind?.forkPoint).toBe(5);
		expect(rolledBack).toEqual([5]);
	});

	test("rewinds a tagged vm cursor", async () => {
		expect((await run("vm:10:2")).rewind?.forkPoint).toBe(5);
	});

	test("a cursor it cannot parse throws instead of marking the reorg handled", async () => {
		const err = await codeOf(() => run("not-a-cursor"));
		expect(err).not.toBeNull();
	});

	test("a consumer before genesis has nothing to roll back", async () => {
		expect((await run(null)).rewind).toBeNull();
	});
});
