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
import type { NftTransfersReader } from "./nft-transfers.ts";
import type { IndexTip } from "./tip.ts";

const BUILD_KEY = "sk-sl_index_build_test";
const FREE_KEY = "sk-sl_index_free_test";
const SCALE_KEY = "sk-sl_index_scale_test";
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
const EMPTY_NFT_READER: NftTransfersReader = async () => ({
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
		createIndexRouter({
			getTip: () => TIP,
			readFtTransfers,
			readNftTransfers: EMPTY_NFT_READER,
		}),
	);
	return app;
}

function createMeteredIndexApp(opts: {
	readFtTransfers?: FtTransfersReader;
	readNftTransfers?: NftTransfersReader;
	recordDecodedEventsReturned: (
		accountId: string,
		quantity: number,
	) => Promise<void>;
}) {
	const app = new Hono();
	app.onError(errorHandler);
	const tokens: IndexTokenStore = new Map([
		[
			"sk-sl_metered_index",
			{
				tenant_id: "account:acct_index",
				account_id: "acct_index",
				tier: "build",
				scopes: [INDEX_READ_SCOPE],
			},
		],
		[
			"sk-sl_unmetered_index",
			{
				tenant_id: "tenant_static_index",
				tier: "build",
				scopes: [INDEX_READ_SCOPE],
			},
		],
		[
			"sk-sl_metered_index_wrong_scope",
			{
				tenant_id: "account:acct_index",
				account_id: "acct_index",
				tier: "build",
				scopes: [],
			},
		],
	]);
	app.route(
		"/v1/index",
		createIndexRouter({
			tokens,
			getTip: () => TIP,
			readFtTransfers: opts.readFtTransfers ?? EMPTY_READER,
			readNftTransfers: opts.readNftTransfers ?? EMPTY_NFT_READER,
			recordDecodedEventsReturned: opts.recordDecodedEventsReturned,
		}),
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

	test("nft-transfers uses the same paid Index gateway", async () => {
		const res = await createApp().request("/v1/index/nft-transfers", {
			headers: authHeaders(SCALE_KEY),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { events: unknown[]; reorgs: unknown[] };
		expect(body.events).toEqual([]);
		expect(body.reorgs).toEqual([]);
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
				readNftTransfers: EMPTY_NFT_READER,
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

	test("meters successful authenticated Index decoded events returned", async () => {
		const metered: Array<{ accountId: string; quantity: number }> = [];
		const app = createMeteredIndexApp({
			recordDecodedEventsReturned: async (accountId, quantity) => {
				metered.push({ accountId, quantity });
			},
			readFtTransfers: async () => ({
				events: [
					{
						cursor: "10:0",
						block_height: 10,
						tx_id: "0x01",
						tx_index: 0,
						event_index: 0,
						event_type: "ft_transfer",
						contract_id: "SP123.token",
						asset_identifier: "SP123.token::coin",
						sender: "SP123.sender",
						recipient: "SP123.recipient",
						amount: "1",
					},
				],
				next_cursor: "10:0",
			}),
			readNftTransfers: async () => ({
				events: [
					{
						cursor: "11:0",
						block_height: 11,
						tx_id: "0x02",
						tx_index: 0,
						event_index: 0,
						event_type: "nft_transfer",
						contract_id: "SP123.nft",
						asset_identifier: "SP123.nft::item",
						sender: "SP123.sender",
						recipient: "SP123.recipient",
						value: "u1",
					},
					{
						cursor: "11:1",
						block_height: 11,
						tx_id: "0x03",
						tx_index: 1,
						event_index: 1,
						event_type: "nft_transfer",
						contract_id: "SP123.nft",
						asset_identifier: "SP123.nft::item",
						sender: "SP123.sender",
						recipient: "SP123.recipient",
						value: "u2",
					},
				],
				next_cursor: "11:1",
			}),
		});

		await app.request("/v1/index/ft-transfers", {
			headers: authHeaders("sk-sl_metered_index"),
		});
		await app.request("/v1/index/nft-transfers", {
			headers: authHeaders("sk-sl_metered_index"),
		});

		expect(metered).toEqual([
			{ accountId: "acct_index", quantity: 1 },
			{ accountId: "acct_index", quantity: 2 },
		]);
	});

	test("does not meter static keys, failed auth, wrong scope, or rate limit responses", async () => {
		const metered: Array<{ accountId: string; quantity: number }> = [];
		const app = createMeteredIndexApp({
			recordDecodedEventsReturned: async (accountId, quantity) => {
				metered.push({ accountId, quantity });
			},
			readFtTransfers: async () => ({
				events: [
					{
						cursor: "10:0",
						block_height: 10,
						tx_id: "0x01",
						tx_index: 0,
						event_index: 0,
						event_type: "ft_transfer",
						contract_id: "SP123.token",
						asset_identifier: "SP123.token::coin",
						sender: "SP123.sender",
						recipient: "SP123.recipient",
						amount: "1",
					},
				],
				next_cursor: "10:0",
			}),
		});

		await app.request("/v1/index/ft-transfers", {
			headers: authHeaders("sk-sl_unmetered_index"),
		});
		await app.request("/v1/index/ft-transfers");
		await app.request("/v1/index/ft-transfers", {
			headers: authHeaders("sk-sl_metered_index_wrong_scope"),
		});
		for (let i = 0; i < 51; i++) {
			await app.request("/v1/index/ft-transfers", {
				headers: authHeaders("sk-sl_unmetered_index"),
			});
		}

		expect(metered).toEqual([]);
	});
});
