import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import { createStreamsRouter } from "../routes/streams.ts";
import type { StreamsEventsReader } from "./events.ts";
import { STREAMS_BLOCKS_PER_DAY } from "./tiers.ts";
import type { StreamsTip } from "./tip.ts";

const FREE_KEY = "sk-sl_streams_free_test";
const STATUS_KEY = "sk-sl_streams_status_public";
const BUILD_KEY = "sk-sl_streams_build_test";
const ENTERPRISE_KEY = "sk-sl_streams_enterprise_test";
const WRONG_SCOPE_KEY = "sk-sl_streams_wrong_scope_test";

const TEST_TIP: StreamsTip = {
	block_height: 10_000,
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
		}),
	);
	return app;
}

function authHeaders(token: string) {
	return { Authorization: `Bearer ${token}` };
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
		expect(seenFromHeight).toBe(TEST_TIP.block_height - STREAMS_BLOCKS_PER_DAY);
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
});
