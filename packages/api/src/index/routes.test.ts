import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import { createIndexRouter } from "../routes/index.ts";
import { createStreamsRouter } from "../routes/streams.ts";
import type { StreamsTokenStore } from "../streams/auth.ts";
import { STREAMS_READ_SCOPE } from "../streams/auth.ts";
import type { StreamsTip } from "../streams/tip.ts";
import { INDEX_READ_SCOPE, type IndexTokenStore } from "./auth.ts";
import type { FtTransfersReader } from "./ft-transfers.ts";
import type { IndexTip } from "./tip.ts";

const BUILD_KEY = "sk-sl_index_build_test";
const FREE_KEY = "sk-sl_index_free_test";
const WRONG_SCOPE_KEY = "sk-sl_index_wrong_scope_test";
const TIP: IndexTip = { block_height: 10_000, lag_seconds: 1 };
const STREAMS_TIP: StreamsTip = {
	block_height: 10_000,
	index_block_hash: "0x01",
	burn_block_height: 20_000,
	lag_seconds: 0,
};

const EMPTY_READER: FtTransfersReader = async () => ({
	events: [],
	next_cursor: null,
});

function authHeaders(token: string) {
	return { Authorization: `Bearer ${token}` };
}

function createApp(readFtTransfers: FtTransfersReader = EMPTY_READER) {
	const app = new Hono();
	app.onError(errorHandler);
	app.route(
		"/v1/index",
		createIndexRouter({ getTip: () => TIP, readFtTransfers }),
	);
	return app;
}

describe("Stacks Index gateway middleware", () => {
	test("free tier is rejected for Index", async () => {
		const res = await createApp().request("/v1/index/ft-transfers", {
			headers: authHeaders(FREE_KEY),
		});
		expect(res.status).toBe(403);
		const body = (await res.json()) as { code: string; error: string };
		expect(body.code).toBe("AUTHORIZATION_ERROR");
		expect(body.error).toContain("free tier");
	});

	test("wrong scope is rejected", async () => {
		const res = await createApp().request("/v1/index/ft-transfers", {
			headers: authHeaders(WRONG_SCOPE_KEY),
		});
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain(INDEX_READ_SCOPE);
	});

	test("build tier gets 50 req/s on Index", async () => {
		const app = createApp();
		for (let i = 0; i < 50; i++) {
			const res = await app.request("/v1/index/ft-transfers", {
				headers: authHeaders(BUILD_KEY),
			});
			expect(res.status).toBe(200);
		}

		const res = await app.request("/v1/index/ft-transfers", {
			headers: authHeaders(BUILD_KEY),
		});
		expect(res.status).toBe(429);
		expect(res.headers.get("X-RateLimit-Limit")).toBe("50");
	});

	test("Index bucket is separate from Streams bucket", async () => {
		const sharedKey = "sk-shared-build";
		const streamsTokens: StreamsTokenStore = new Map([
			[
				sharedKey,
				{
					tenant_id: "tenant_shared_build",
					tier: "build",
					scopes: [STREAMS_READ_SCOPE],
				},
			],
		]);
		const indexTokens: IndexTokenStore = new Map([
			[
				sharedKey,
				{
					tenant_id: "tenant_shared_build",
					tier: "build",
					scopes: [INDEX_READ_SCOPE],
				},
			],
		]);
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/streams",
			createStreamsRouter({
				tokens: streamsTokens,
				getTip: () => STREAMS_TIP,
				readEvents: async () => ({ events: [], next_cursor: null }),
			}),
		);
		app.route(
			"/v1/index",
			createIndexRouter({
				tokens: indexTokens,
				getTip: () => TIP,
				readFtTransfers: EMPTY_READER,
			}),
		);

		for (let i = 0; i < 50; i++) {
			const res = await app.request("/v1/streams/events", {
				headers: authHeaders(sharedKey),
			});
			expect(res.status).toBe(200);
		}
		for (let i = 0; i < 50; i++) {
			const res = await app.request("/v1/index/ft-transfers", {
				headers: authHeaders(sharedKey),
			});
			expect(res.status).toBe(200);
		}
	});
});
