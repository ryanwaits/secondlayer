import { describe, expect, test } from "bun:test";
import { consumeStreamsEvents } from "./consumer.ts";
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
