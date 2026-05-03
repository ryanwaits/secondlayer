import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import { createStreamsRouter } from "../routes/streams.ts";
import type { StreamsTip } from "./tip.ts";
import { STREAMS_BLOCKS_PER_DAY } from "./tiers.ts";

const FREE_KEY = "sk-sl_streams_free_test";
const BUILD_KEY = "sk-sl_streams_build_test";
const WRONG_SCOPE_KEY = "sk-sl_streams_wrong_scope_test";

const TEST_TIP: StreamsTip = {
	block_height: 10_000,
	index_block_hash:
		"0x0000000000000000000000000000000000000000000000000000000000000001",
	burn_block_height: 20_000,
	lag_seconds: 0,
};

function createApp() {
	const app = new Hono();
	app.onError(errorHandler);
	app.route(
		"/v1/streams",
		createStreamsRouter({
			getTip: () => TEST_TIP,
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
});
