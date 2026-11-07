import { describe, expect, test } from "bun:test";
import { createStreamsClient } from "./client.ts";
import {
	type StreamsEventsFetcher,
	iterateStreamsBatches,
	streamStreamsEvents,
} from "./consumer.ts";
import { StreamsServerError } from "./errors.ts";
import { subscribeStreamsEvents } from "./subscribe.ts";
import type {
	FetchLike,
	StreamsEvent,
	StreamsEventsEnvelope,
	StreamsSubscriptionState,
} from "./types.ts";

const TIP = { block_height: 10 } as StreamsEventsEnvelope["tip"];

function event(cursor: string): StreamsEvent {
	return { cursor, block_height: Number(cursor.split(":")[0]) } as StreamsEvent;
}

function page(
	events: StreamsEvent[],
	next_cursor: string | null,
	reorgs: StreamsEventsEnvelope["reorgs"] = [],
): StreamsEventsEnvelope {
	return { events, next_cursor, tip: TIP, reorgs } as StreamsEventsEnvelope;
}

const noSleep = async () => {};

/** A fetch that never answers until the request is aborted. */
const stalledFetch: FetchLike = (_url, init) =>
	new Promise((_resolve, reject) => {
		init?.signal?.addEventListener("abort", () =>
			reject(new DOMException("aborted", "AbortError")),
		);
	});

describe("streams connect timeout", () => {
	test("a request whose headers never arrive fails fast with a retryable timeout", async () => {
		const client = createStreamsClient({
			baseUrl: "http://127.0.0.1:1",
			fetchImpl: stalledFetch,
			connectTimeoutMs: 30,
			verify: false,
		});
		const err = await client.tip().then(
			() => null,
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(StreamsServerError);
		expect((err as StreamsServerError).code).toBe("REQUEST_TIMEOUT");
		expect((err as StreamsServerError).retryable).toBe(true);
	});

	test("a caller abort is not reported as a timeout", async () => {
		const controller = new AbortController();
		const client = createStreamsClient({
			baseUrl: "http://127.0.0.1:1",
			fetchImpl: (url, init) =>
				stalledFetch(url, { ...init, signal: controller.signal }),
			connectTimeoutMs: 5_000,
			verify: false,
		});
		const pending = client.tip();
		controller.abort();
		const err = await pending.then(
			() => null,
			(e: unknown) => e,
		);
		expect(err).not.toBeInstanceOf(StreamsServerError);
	});
});

describe("subscribe lifecycle state", () => {
	function openStream(): FetchLike {
		return (_url, init) => {
			const signal = init?.signal ?? undefined;
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					signal?.addEventListener(
						"abort",
						() => {
							try {
								controller.close();
							} catch {
								// already closed
							}
						},
						{ once: true },
					);
				},
			});
			return Promise.resolve(
				new Response(body, {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				}),
			);
		};
	}

	test("reports connecting, open, then closed once on unsubscribe", async () => {
		const states: StreamsSubscriptionState[] = [];
		const sub = subscribeStreamsEvents({
			baseUrl: "http://x",
			fetchImpl: openStream(),
			verify: "off",
			loadKey: () => {
				throw new Error("unused");
			},
			params: { onEvent: () => {}, onState: (s) => states.push(s) },
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		sub();
		await sub.done;
		expect(states).toEqual(["connecting", "open", "closed"]);
	});

	test("reports reconnecting between a failed attempt and the next connect", async () => {
		const states: StreamsSubscriptionState[] = [];
		let calls = 0;
		const open = openStream();
		const sub = subscribeStreamsEvents({
			baseUrl: "http://x",
			fetchImpl: (url, init) => {
				calls++;
				if (calls === 1) {
					return Promise.resolve(new Response("down", { status: 503 }));
				}
				return open(url, init);
			},
			verify: "off",
			loadKey: () => {
				throw new Error("unused");
			},
			reconnectDelayMs: 1,
			random: () => 0,
			params: {
				onEvent: () => {},
				onError: () => {},
				onState: (s) => states.push(s),
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 60));
		sub();
		await sub.done;
		expect(states).toEqual([
			"connecting",
			"reconnecting",
			"connecting",
			"open",
			"closed",
		]);
	});

	test("a throwing state observer does not break the subscription", async () => {
		const sub = subscribeStreamsEvents({
			baseUrl: "http://x",
			fetchImpl: openStream(),
			verify: "off",
			loadKey: () => {
				throw new Error("unused");
			},
			params: {
				onEvent: () => {},
				onState: () => {
					throw new Error("observer bug");
				},
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		sub();
		await expect(sub.done).resolves.toBeUndefined();
	});
});

describe("iterate and stream run on the consume loop", () => {
	test("stream yields every event across pages in order", async () => {
		const pages = [
			page([event("1:0"), event("1:1")], "1:1"),
			page([event("2:0")], "2:0"),
			page([], "2:0"),
		];
		const fetchEvents: StreamsEventsFetcher = async () =>
			pages.shift() ?? page([], "2:0");
		const seen: string[] = [];
		for await (const e of streamStreamsEvents({
			batchSize: 10,
			fetchEvents,
			sleep: noSleep,
			maxEmptyPolls: 1,
		})) {
			seen.push(e.cursor);
		}
		expect(seen).toEqual(["1:0", "1:1", "2:0"]);
	});

	test("stream retries a transient page failure instead of throwing", async () => {
		let calls = 0;
		const fetchEvents: StreamsEventsFetcher = async () => {
			calls++;
			if (calls === 1) throw new StreamsServerError("boom", 503);
			return calls === 2 ? page([event("1:0")], "1:0") : page([], "1:0");
		};
		const seen: string[] = [];
		for await (const e of streamStreamsEvents({
			batchSize: 10,
			fetchEvents,
			sleep: noSleep,
			maxEmptyPolls: 1,
		})) {
			seen.push(e.cursor);
		}
		expect(seen).toEqual(["1:0"]);
		expect(calls).toBe(3);
	});

	test("stream throws when a page returns events but the cursor does not move", async () => {
		const fetchEvents: StreamsEventsFetcher = async () =>
			page([event("1:0")], "1:0");
		const seen: string[] = [];
		const run = async () => {
			for await (const e of streamStreamsEvents({
				fromCursor: "1:0",
				batchSize: 10,
				fetchEvents,
				sleep: noSleep,
			})) {
				seen.push(e.cursor);
			}
		};
		const err = await run().then(
			() => null,
			(e: unknown) => e,
		);
		expect((err as StreamsServerError).code).toBe("CURSOR_STALLED");
		expect(seen).toEqual(["1:0"]);
	});

	test("iterate yields a batch per non-empty page with its cursor, tip and reorgs, skipping empty pages", async () => {
		const reorg = {
			fork_point_height: 1,
			detected_at: "t",
			new_canonical_tip: "x",
		} as unknown as StreamsEventsEnvelope["reorgs"][number];
		const script = [
			page([event("1:0")], "1:0"),
			page([], "1:0"),
			page([], "1:0", [reorg]),
		];
		const controller = new AbortController();
		const fetchEvents: StreamsEventsFetcher = async () => {
			const next = script.shift();
			if (!next) {
				controller.abort();
				return page([], "1:0");
			}
			return next;
		};
		const batches: { cursor: string | null; events: number; reorgs: number }[] =
			[];
		for await (const batch of iterateStreamsBatches({
			batchSize: 10,
			intervalMs: 1,
			fetchEvents,
			sleep: noSleep,
			signal: controller.signal,
		})) {
			expect(batch.tip).toBe(TIP);
			batches.push({
				cursor: batch.cursor,
				events: batch.events.length,
				reorgs: batch.reorgs.length,
			});
		}
		expect(batches).toEqual([
			{ cursor: "1:0", events: 1, reorgs: 0 },
			{ cursor: "1:0", events: 0, reorgs: 1 },
		]);
	});

	test("breaking out of iteration stops fetching and does not hang", async () => {
		let calls = 0;
		const fetchEvents: StreamsEventsFetcher = async () => {
			calls++;
			return page([event(`${calls}:0`)], `${calls}:0`);
		};
		for await (const batch of iterateStreamsBatches({
			batchSize: 10,
			intervalMs: 1,
			fetchEvents,
			sleep: noSleep,
		})) {
			expect(batch.events).toHaveLength(1);
			break;
		}
		const settled = calls;
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(calls).toBe(settled);
		expect(settled).toBe(1);
	});
});
