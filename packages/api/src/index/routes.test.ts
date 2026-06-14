import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { Hono } from "hono";
import { _resetRateLimitStoreForTests } from "../auth/rate-limit-store.ts";
import { errorHandler } from "../middleware/error.ts";
import { createIndexRouter } from "../routes/index.ts";
import { createStreamsRouter } from "../routes/streams.ts";
import type { StreamsTokenStore } from "../streams/auth.ts";
import { STREAMS_READ_SCOPE } from "../streams/auth.ts";
import type { StreamsTip } from "../streams/tip.ts";
import { INDEX_READ_SCOPE, type IndexTokenStore } from "./auth.ts";
import type { FtTransfersReader } from "./ft-transfers.ts";
import type { NftTransfersReader } from "./nft-transfers.ts";
import {
	INDEX_ANON_RATE_LIMIT_PER_SECOND,
	INDEX_TIER_CONFIG,
} from "./tiers.ts";
import type { IndexTip } from "./tip.ts";

const BUILD_KEY = "sk-sl_index_build_test";
const FREE_KEY = "sk-sl_index_free_test";
const SCALE_KEY = "sk-sl_index_scale_test";
const WRONG_SCOPE_KEY = "sk-sl_index_wrong_scope_test";
const TIP: IndexTip = {
	block_height: 10_000,
	finalized_height: 9_994,
	lag_seconds: 1,
};
const STREAMS_TIP: StreamsTip = {
	block_height: 10_000,
	block_hash: "0x01",
	burn_block_height: 20_000,
	finalized_height: 9_994,
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
			readReorgs: async () => [],
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
			readReorgs: async () => [],
			recordDecodedEventsReturned: opts.recordDecodedEventsReturned,
		}),
	);
	return app;
}

describe("Stacks Index gateway middleware", () => {
	// Rate limit + free-window gates are platform-only (self-host is single-tenant).
	let prevMode: string | undefined;
	beforeAll(() => {
		prevMode = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "platform";
	});
	afterAll(() => {
		if (prevMode === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prevMode;
	});
	beforeEach(async () => {
		await _resetRateLimitStoreForTests();
	});

	test("anon GET ft-transfers returns 200 with bounded anon rate limit", async () => {
		const app = createApp();
		const res = await app.request("/v1/index/ft-transfers");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { events: unknown[] };
		expect(body.events).toEqual([]);
		// Open beta: anon reads aren't auth-gated but are bounded by a shared
		// global limit, so they always carry X-RateLimit-* headers.
		expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
		expect(res.headers.get("X-RateLimit-Remaining")).not.toBeNull();
	});

	test("anon GET nft-transfers returns 200", async () => {
		const res = await createApp().request("/v1/index/nft-transfers");
		expect(res.status).toBe(200);
	});

	test("free-tier key reads Index at the free rate limit", async () => {
		const res = await createApp().request("/v1/index/ft-transfers", {
			headers: authHeaders(FREE_KEY),
		});
		expect(res.status).toBe(200);
	});

	test("tier ladder: paid is never slower than anonymous", () => {
		expect(
			INDEX_TIER_CONFIG.free.rateLimitPerSecond ?? Number.POSITIVE_INFINITY,
		).toBeGreaterThanOrEqual(INDEX_ANON_RATE_LIMIT_PER_SECOND);
		expect(INDEX_TIER_CONFIG.build.rateLimitPerSecond).toBe(250);
		expect(INDEX_TIER_CONFIG.scale.rateLimitPerSecond).toBe(500);
		expect(INDEX_TIER_CONFIG.enterprise.rateLimitPerSecond).toBeNull();
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

	test("build tier gets 250 req/s on Index", async () => {
		const app = createApp();
		for (let i = 0; i < 250; i++) {
			const res = await app.request("/v1/index/ft-transfers", {
				headers: authHeaders(BUILD_KEY),
			});
			expect(res.status).toBe(200);
		}

		const res = await app.request("/v1/index/ft-transfers", {
			headers: authHeaders(BUILD_KEY),
		});
		expect(res.status).toBe(429);
		expect(res.headers.get("X-RateLimit-Limit")).toBe("250");
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
				readReorgs: async () => [],
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

	test("GET /events requires event_type", async () => {
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/index",
			createIndexRouter({
				getTip: () => TIP,
				readReorgs: async () => [],
			}),
		);
		const res = await app.request("/v1/index/events");
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("event_type is required");
	});

	test("GET /events serves a chosen event_type via the injected reader", async () => {
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/index",
			createIndexRouter({
				getTip: () => TIP,
				readReorgs: async () => [],
				readEvents: async ({ eventType }) => ({
					events: [
						{
							cursor: "10:0",
							block_height: 10,
							tx_id: "0x01",
							tx_index: 0,
							event_index: 0,
							event_type: eventType,
							contract_id: "SP123.token",
							asset_identifier: "SP123.token::coin",
							sender: "SP123.sender",
							recipient: "SP123.recipient",
							amount: "1",
						},
					],
					next_cursor: "10:0",
				}),
			}),
		);
		const res = await app.request("/v1/index/events?event_type=ft_transfer");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			events: Array<{ event_type: string }>;
			reorgs: unknown[];
		};
		expect(body.events.map((e) => e.event_type)).toEqual(["ft_transfer"]);
		expect(body.reorgs).toEqual([]);
	});

	test("GET /contract-calls serves via the injected reader with reorgs: []", async () => {
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/index",
			createIndexRouter({
				getTip: () => TIP,
				readReorgs: async () => [],
				readContractCalls: async () => ({
					contract_calls: [
						{
							cursor: "10:0",
							block_height: 10,
							tx_id: "0x01",
							tx_index: 0,
							contract_id: "SP1.c",
							function_name: "transfer",
							sender: "SP2",
							status: "success",
							args: [],
							result: null,
							result_hex: null,
						},
					],
					next_cursor: "10:0",
				}),
			}),
		);
		const res = await app.request("/v1/index/contract-calls");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			contract_calls: unknown[];
			reorgs: unknown[];
		};
		expect(body.contract_calls).toHaveLength(1);
		expect(body.reorgs).toEqual([]);
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

describe("Index sBTC peg routes", () => {
	function sbtcApp() {
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/index",
			createIndexRouter({
				getTip: () => TIP,
				readReorgs: async () => [],
				readSbtcEvents: async () => ({
					events: [
						{
							cursor: "9000:0",
							block_height: 9000,
							block_time: null,
							tx_id: "0x9000",
							tx_index: 0,
							event_index: 0,
							topic: "completed-deposit",
							request_id: null,
							amount: "1000",
							sender: "SP1",
							recipient_btc_version: 1,
							recipient_btc_hashbytes: "0xab",
							bitcoin_txid: "0xbtc",
							output_index: 0,
							sweep_txid: null,
							burn_hash: null,
							burn_height: null,
							signer_bitmap: null,
							max_fee: null,
							fee: null,
							governance_contract_type: null,
							governance_new_contract: null,
							signer_aggregate_pubkey: null,
							signer_threshold: null,
							signer_address: null,
							signer_keys_count: null,
						},
					],
					next_cursor: "9000:0",
				}),
				readSbtcDeposits: async () => ({ deposits: [], next_cursor: null }),
				readSbtcWithdrawals: async () => ({
					withdrawals: [
						{
							cursor: "9000:0",
							request_id: 7,
							status: "ACCEPTED",
							amount: "500",
							sender: "SP1",
							recipient_btc_version: 1,
							recipient_btc_hashbytes: "0xab",
							sweep_txid: "0xsweep",
							requested_at: null,
							resolved_at: null,
						},
					],
					next_cursor: "9000:0",
				}),
				readSbtcWithdrawalById: async (requestId) =>
					requestId === 7
						? {
								request_id: 7,
								status: "ACCEPTED",
								amount: "500",
								sender: "SP1",
								recipient_btc_version: 1,
								recipient_btc_hashbytes: "0xab",
								requested: {
									block_height: 9000,
									block_time: null,
									tx_id: "0xreq",
								},
								accepted: {
									block_height: 9001,
									block_time: null,
									tx_id: "0xacc",
									sweep_txid: "0xsweep",
									signer_bitmap: null,
								},
								rejected: null,
								settlement: {
									sweep_txid: "0xsweep",
									btc_confirmations: null,
									settlement_confirmed: null,
								},
								latest_height: 9001,
							}
						: null,
				readSbtcDepositByTxid: async (txid) =>
					txid === "0xbtc"
						? {
								cursor: "9000:0",
								block_height: 9000,
								block_time: null,
								tx_id: "0x9000",
								tx_index: 0,
								event_index: 0,
								amount: "1000",
								sender: "SP1",
								bitcoin_txid: "0xbtc",
								output_index: 0,
								recipient_btc_version: 1,
								recipient_btc_hashbytes: "0xab",
								status: "COMPLETED",
							}
						: null,
			}),
		);
		return app;
	}

	test("events returns the envelope, keyless", async () => {
		const res = await sbtcApp().request("/v1/index/sbtc/events");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { events: unknown[]; tip: unknown };
		expect(body.events).toHaveLength(1);
		expect(body.tip).toBeDefined();
	});

	test("withdrawals rollup is never immutably cached", async () => {
		const res = await sbtcApp().request("/v1/index/sbtc/withdrawals");
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe("private, max-age=2");
		expect(res.headers.get("ETag")).toBeNull();
		const body = (await res.json()) as {
			withdrawals: Array<{ status: string }>;
		};
		expect(body.withdrawals[0]?.status).toBe("ACCEPTED");
	});

	test("rejects an unknown query filter", async () => {
		const res = await sbtcApp().request("/v1/index/sbtc/events?bogus=1");
		expect(res.status).toBe(400);
	});

	test("withdrawal by request_id returns the assembled lifecycle, immutable when terminal+finalized", async () => {
		const res = await sbtcApp().request("/v1/index/sbtc/withdrawals/7");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			withdrawal: { status: string; finalized: boolean; accepted: unknown };
		};
		expect(body.withdrawal.status).toBe("ACCEPTED");
		// latest_height 9001 ≤ finalized_height 9994 and terminal → immutable.
		expect(body.withdrawal.finalized).toBe(true);
		expect(res.headers.get("ETag")).not.toBeNull();
	});

	test("unknown withdrawal request_id → 404", async () => {
		const res = await sbtcApp().request("/v1/index/sbtc/withdrawals/999");
		expect(res.status).toBe(404);
	});

	test("malformed request_id → 400", async () => {
		const res = await sbtcApp().request("/v1/index/sbtc/withdrawals/abc");
		expect(res.status).toBe(400);
	});

	test("deposit by bitcoin_txid returns the typed object", async () => {
		const res = await sbtcApp().request("/v1/index/sbtc/deposits/0xbtc");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { deposit: { status: string } };
		expect(body.deposit.status).toBe("COMPLETED");
	});
});
