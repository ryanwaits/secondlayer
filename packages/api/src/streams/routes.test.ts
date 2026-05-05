import { describe, expect, test } from "bun:test";
import type { StreamsEvent } from "@secondlayer/indexer/streams-events";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import { createStreamsRouter } from "../routes/streams.ts";
import { STREAMS_READ_SCOPE, type StreamsTokenStore } from "./auth.ts";
import type { StreamsEventsReader } from "./events.ts";
import { STREAMS_BLOCKS_PER_DAY } from "./tiers.ts";
import type { StreamsTip } from "./tip.ts";

const FREE_KEY = "sk-sl_streams_free_test";
const STATUS_KEY = "sk-sl_streams_status_public";
const BUILD_KEY = "sk-sl_streams_build_test";
const ENTERPRISE_KEY = "sk-sl_streams_enterprise_test";
const WRONG_SCOPE_KEY = "sk-sl_streams_wrong_scope_test";

const TEST_TIP: StreamsTip = {
	block_height: 200_000,
	index_block_hash:
		"0x0000000000000000000000000000000000000000000000000000000000000001",
	burn_block_height: 20_000,
	lag_seconds: 0,
};

const EMPTY_EVENTS_READER: StreamsEventsReader = async () => ({
	events: [],
	next_cursor: null,
});

function createApp(readEvents: StreamsEventsReader = EMPTY_EVENTS_READER) {
	const app = new Hono();
	app.onError(errorHandler);
	app.route(
		"/v1/streams",
		createStreamsRouter({
			getTip: () => TEST_TIP,
			readEvents,
			readReorgs: async () => [],
		}),
	);
	return app;
}

function createMeteredApp(opts: {
	readEvents?: StreamsEventsReader;
	recordEventsReturned: (accountId: string, quantity: number) => Promise<void>;
}) {
	const app = new Hono();
	app.onError(errorHandler);
	const tokens: StreamsTokenStore = new Map([
		[
			"sk-sl_metered_streams",
			{
				tenant_id: "account:acct_streams",
				account_id: "acct_streams",
				tier: "build",
				scopes: [STREAMS_READ_SCOPE],
			},
		],
		[
			"sk-sl_unmetered_streams",
			{
				tenant_id: "tenant_static",
				tier: "build",
				scopes: [STREAMS_READ_SCOPE],
			},
		],
		[
			"sk-sl_metered_wrong_scope",
			{
				tenant_id: "account:acct_streams",
				account_id: "acct_streams",
				tier: "build",
				scopes: [],
			},
		],
	]);
	app.route(
		"/v1/streams",
		createStreamsRouter({
			tokens,
			getTip: () => TEST_TIP,
			readEvents: opts.readEvents ?? EMPTY_EVENTS_READER,
			readReorgs: async () => [],
			recordEventsReturned: opts.recordEventsReturned,
		}),
	);
	return app;
}

function authHeaders(token: string) {
	return { Authorization: `Bearer ${token}` };
}

function streamsEvent(overrides: Partial<StreamsEvent> = {}): StreamsEvent {
	return {
		cursor: "100:0",
		block_height: 100,
		index_block_hash: TEST_TIP.index_block_hash,
		burn_block_height: TEST_TIP.burn_block_height,
		tx_id: "0xtx",
		tx_index: 0,
		event_index: 0,
		event_type: "stx_transfer",
		contract_id: null,
		payload: {},
		ts: "2026-05-02T21:43:00.000Z",
		...overrides,
	};
}

describe("Stacks Streams gateway middleware", () => {
	test("Free-tier key gets 429 at 11 req/s sustained", async () => {
		const app = createApp();

		for (let i = 0; i < 10; i++) {
			const res = await app.request("/v1/streams/events", {
				headers: authHeaders(FREE_KEY),
			});
			expect(res.status).toBe(200);
		}

		const res = await app.request("/v1/streams/events", {
			headers: authHeaders(FREE_KEY),
		});
		expect(res.status).toBe(429);
		expect(res.headers.get("Retry-After")).toBeTruthy();
		expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
	});

	test("Build-tier key passes through at 50 req/s", async () => {
		const app = createApp();

		for (let i = 0; i < 50; i++) {
			const res = await app.request("/v1/streams/events", {
				headers: authHeaders(BUILD_KEY),
			});
			expect(res.status).toBe(200);
		}
	});

	test("Free-tier key requesting from_block older than 7 days gets 403", async () => {
		const app = createApp();
		const oldBlock = TEST_TIP.block_height - 7 * STREAMS_BLOCKS_PER_DAY - 1;
		const res = await app.request(`/v1/streams/events?from_block=${oldBlock}`, {
			headers: authHeaders(FREE_KEY),
		});

		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("free tier");
		expect(body.error).toContain("last 7 days");
	});

	test("Missing token returns 401", async () => {
		const app = createApp();
		const res = await app.request("/v1/streams/events");
		expect(res.status).toBe(401);
	});

	test("Wrong scope returns 403", async () => {
		const app = createApp();
		const res = await app.request("/v1/streams/events", {
			headers: authHeaders(WRONG_SCOPE_KEY),
		});
		expect(res.status).toBe(403);
	});

	test("/tip returns 200 with the expected shape", async () => {
		const app = createApp();
		const res = await app.request("/v1/streams/tip", {
			headers: authHeaders(FREE_KEY),
		});

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual(TEST_TIP);
	});

	test("/canonical/:height returns canonical block with nullable burn hash", async () => {
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/streams",
			createStreamsRouter({
				getTip: () => TEST_TIP,
				readEvents: EMPTY_EVENTS_READER,
				readReorgs: async () => [],
				readCanonicalBlock: async (height) => ({
					block_height: height,
					index_block_hash: "0xabc",
					burn_block_height: 77,
					burn_block_hash: null,
					is_canonical: true,
				}),
			}),
		);

		const res = await app.request("/v1/streams/canonical/100", {
			headers: authHeaders(BUILD_KEY),
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("ETag")).toBe('"0xabc"');
		await expect(res.json()).resolves.toEqual({
			block_height: 100,
			index_block_hash: "0xabc",
			burn_block_height: 77,
			burn_block_hash: null,
			is_canonical: true,
		});
	});

	test("/events/:tx_id returns tx events with overlapping reorgs", async () => {
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/streams",
			createStreamsRouter({
				getTip: () => TEST_TIP,
				readEvents: EMPTY_EVENTS_READER,
				readEventsByTxId: async ({ txId }) => ({
					events: [
						streamsEvent({ tx_id: txId, cursor: "100:0", event_index: 0 }),
						streamsEvent({ tx_id: txId, cursor: "100:1", event_index: 1 }),
					],
				}),
				readReorgs: async (range) => [
					{
						id: "reorg-1",
						detected_at: "2026-05-03T12:30:00.000Z",
						fork_point_height: range.from.block_height,
						old_index_block_hash: "0xold",
						new_index_block_hash: "0xnew",
						orphaned_range: { from: "100:0", to: "100:1" },
						new_canonical_tip: "100:0",
					},
				],
			}),
		);

		const res = await app.request("/v1/streams/events/0xtx", {
			headers: authHeaders(BUILD_KEY),
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			events: Array<{ tx_id: string }>;
			reorgs: unknown[];
		};
		expect(body.events).toHaveLength(2);
		expect(body.events[0]?.tx_id).toBe("0xtx");
		expect(body.reorgs).toHaveLength(1);
	});

	test("/blocks/:heightOrHash/events returns block events by hash", async () => {
		let seenHash: string | undefined;
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/streams",
			createStreamsRouter({
				getTip: () => TEST_TIP,
				readEvents: EMPTY_EVENTS_READER,
				readBlockEvents: async ({ indexBlockHash }) => {
					seenHash = indexBlockHash;
					return { events: [streamsEvent({ index_block_hash: "0xblock" })] };
				},
				readReorgs: async () => [],
			}),
		);

		const res = await app.request("/v1/streams/blocks/0xblock/events", {
			headers: authHeaders(BUILD_KEY),
		});

		expect(res.status).toBe(200);
		expect(seenHash).toBe("0xblock");
		const body = (await res.json()) as { events: unknown[] };
		expect(body.events).toHaveLength(1);
	});

	test("/reorgs validates since and returns next_since", async () => {
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/streams",
			createStreamsRouter({
				getTip: () => TEST_TIP,
				readEvents: EMPTY_EVENTS_READER,
				readReorgs: async () => [],
				readReorgsSince: async ({ since, limit }) => {
					expect(since).toBeInstanceOf(Date);
					expect(limit).toBe(2);
					return [
						{
							id: "reorg-1",
							detected_at: "2026-05-03T12:30:00.000Z",
							fork_point_height: 100,
							old_index_block_hash: "0xold",
							new_index_block_hash: "0xnew",
							orphaned_range: { from: "100:0", to: "101:3" },
							new_canonical_tip: "101:0",
						},
					];
				},
			}),
		);

		const res = await app.request(
			"/v1/streams/reorgs?since=2026-05-03T00:00:00.000Z&limit=2",
			{ headers: authHeaders(BUILD_KEY) },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({
			reorgs: [{ id: "reorg-1" }],
			next_since: "2026-05-03T12:30:00.000Z",
		});
	});

	test("public status key can read /tip", async () => {
		const app = createApp();
		const res = await app.request("/v1/streams/tip", {
			headers: authHeaders(STATUS_KEY),
		});

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual(TEST_TIP);
	});

	test("/events rejects from_height with cursor", async () => {
		const app = createApp();
		const res = await app.request(
			"/v1/streams/events?cursor=9999:0&from_height=9999",
			{
				headers: authHeaders(BUILD_KEY),
			},
		);

		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("mutually exclusive");
	});

	test("/events rejects malformed cursors", async () => {
		const app = createApp();
		const res = await app.request("/v1/streams/events?cursor=0001:0", {
			headers: authHeaders(BUILD_KEY),
		});

		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("<block_height>:<event_index>");
	});

	test("/events clamps limit to 1000", async () => {
		const app = createApp(async ({ limit }) => ({
			events: Array.from({ length: limit }, (_, i) => ({
				cursor: `1:${i}`,
				block_height: 1,
				index_block_hash: TEST_TIP.index_block_hash,
				burn_block_height: TEST_TIP.burn_block_height,
				tx_id: `0x${i}`,
				tx_index: i,
				event_index: i,
				event_type: "stx_transfer",
				contract_id: null,
				payload: {},
				ts: "2026-05-02T21:43:00.000Z",
			})),
			next_cursor: "1:999",
		}));
		const res = await app.request("/v1/streams/events?limit=5000", {
			headers: authHeaders(BUILD_KEY),
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as { events: unknown[]; reorgs: unknown[] };
		expect(body.events).toHaveLength(1000);
		expect(body.reorgs).toEqual([]);
	});

	test("/events with no params uses the default one-day window quickly", async () => {
		let seenFromHeight: number | undefined;
		const app = createApp(async ({ fromHeight }) => {
			seenFromHeight = fromHeight;
			return {
				events: [
					{
						cursor: "9999:0",
						block_height: 9999,
						index_block_hash: TEST_TIP.index_block_hash,
						burn_block_height: TEST_TIP.burn_block_height,
						tx_id: "0x01",
						tx_index: 0,
						event_index: 0,
						event_type: "stx_transfer",
						contract_id: null,
						payload: {},
						ts: "2026-05-02T21:43:00.000Z",
					},
				],
				next_cursor: "9999:0",
			};
		});

		const startedAt = performance.now();
		const res = await app.request("/v1/streams/events", {
			headers: authHeaders(BUILD_KEY),
		});
		const elapsedMs = performance.now() - startedAt;

		expect(res.status).toBe(200);
		expect(elapsedMs).toBeLessThan(1000);
		expect(seenFromHeight).toBe(
			Math.max(0, TEST_TIP.block_height - STREAMS_BLOCKS_PER_DAY),
		);
		const body = (await res.json()) as { next_cursor: string | null };
		expect(body.next_cursor).toBe("9999:0");
	});

	test("/events from_cursor=0:0 bypasses the default one-day window", async () => {
		let seenAfter: unknown;
		let seenFromHeight: number | undefined = -1;
		const app = createApp(async ({ after, fromHeight }) => {
			seenAfter = after;
			seenFromHeight = fromHeight;
			return { events: [], next_cursor: null };
		});

		const res = await app.request("/v1/streams/events?from_cursor=0:0", {
			headers: authHeaders(ENTERPRISE_KEY),
		});

		expect(res.status).toBe(200);
		expect(seenAfter).toEqual({ block_height: 0, event_index: 0 });
		expect(seenFromHeight).toBeUndefined();
	});

	test("meters successful authenticated Streams events returned", async () => {
		const metered: Array<{ accountId: string; quantity: number }> = [];
		const app = createMeteredApp({
			recordEventsReturned: async (accountId, quantity) => {
				metered.push({ accountId, quantity });
			},
			readEvents: async () => ({
				events: [
					{
						cursor: "9999:0",
						block_height: 9999,
						index_block_hash: TEST_TIP.index_block_hash,
						burn_block_height: TEST_TIP.burn_block_height,
						tx_id: "0x01",
						tx_index: 0,
						event_index: 0,
						event_type: "stx_transfer",
						contract_id: null,
						payload: {},
						ts: "2026-05-02T21:43:00.000Z",
					},
					{
						cursor: "9999:1",
						block_height: 9999,
						index_block_hash: TEST_TIP.index_block_hash,
						burn_block_height: TEST_TIP.burn_block_height,
						tx_id: "0x02",
						tx_index: 1,
						event_index: 1,
						event_type: "print",
						contract_id: "SP123.contract",
						payload: {},
						ts: "2026-05-02T21:43:01.000Z",
					},
				],
				next_cursor: "9999:1",
			}),
		});

		const res = await app.request("/v1/streams/events", {
			headers: authHeaders("sk-sl_metered_streams"),
		});

		expect(res.status).toBe(200);
		expect(metered).toEqual([{ accountId: "acct_streams", quantity: 2 }]);
	});

	test("does not meter static keys, failed auth, wrong scope, or /tip", async () => {
		const metered: Array<{ accountId: string; quantity: number }> = [];
		const app = createMeteredApp({
			recordEventsReturned: async (accountId, quantity) => {
				metered.push({ accountId, quantity });
			},
			readEvents: async () => ({
				events: [
					{
						cursor: "9999:0",
						block_height: 9999,
						index_block_hash: TEST_TIP.index_block_hash,
						burn_block_height: TEST_TIP.burn_block_height,
						tx_id: "0x01",
						tx_index: 0,
						event_index: 0,
						event_type: "stx_transfer",
						contract_id: null,
						payload: {},
						ts: "2026-05-02T21:43:00.000Z",
					},
				],
				next_cursor: "9999:0",
			}),
		});

		await app.request("/v1/streams/events", {
			headers: authHeaders("sk-sl_unmetered_streams"),
		});
		await app.request("/v1/streams/events");
		await app.request("/v1/streams/events", {
			headers: authHeaders("sk-sl_metered_wrong_scope"),
		});
		await app.request("/v1/streams/tip", {
			headers: authHeaders("sk-sl_metered_streams"),
		});

		expect(metered).toEqual([]);
	});
});
