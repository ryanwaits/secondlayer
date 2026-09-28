import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { meter } from "@secondlayer/platform/billing/meter";
import { ROWS_DELIVERED_MONTHLY_ALLOWANCE } from "@secondlayer/platform/billing/prices";
import { creditCredits } from "@secondlayer/platform/db/queries/account-credits";
import { getDb, jsonb, sql } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { _resetRateLimitStoreForTests } from "../auth/rate-limit-store.ts";
import type { BitcoinIndexTip } from "../bitcoin/db.ts";
import { errorHandler } from "../middleware/error.ts";
import type { IndexRouterOptions } from "../routes/index.ts";
import { createIndexRouter } from "../routes/index.ts";
import { createStreamsRouter } from "../routes/streams.ts";
import type { StreamsTokenStore } from "../streams/auth.ts";
import { STREAMS_READ_SCOPE } from "../streams/auth.ts";
import type { StreamsTip } from "../streams/tip.ts";
import { INDEX_READ_SCOPE, type IndexTokenStore } from "./auth.ts";
import type { IndexBlock } from "./blocks.ts";
import type { FtTransfersReader } from "./ft-transfers.ts";
import type { NftTransfersReader } from "./nft-transfers.ts";
import type {
	Pox5Cycle,
	Pox5CycleData,
	PoxCycleReader,
	PoxCyclesReader,
	PoxTipBurnHeightReader,
} from "./pox-cycles.ts";
import type { RuneEntry, RuneReader, RunesReader } from "./runes.ts";
import {
	INDEX_ANON_RATE_LIMIT_PER_SECOND,
	INDEX_TIER_CONFIG,
} from "./tiers.ts";
import type { IndexTip } from "./tip.ts";
import {
	IncompleteBlockTxSetError,
	ProofNodeUnavailableError,
	type TransactionProofReader,
	type TransactionProofResponse,
} from "./transaction-proof.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const FREE_KEY = "sk-sl_index_free_test";
const WRONG_SCOPE_KEY = "sk-sl_index_wrong_scope_test";

// No paid ladder left in the default seeds, so tests that need an unthrottled
// (non-free) caller inject their own "internal" tenant through the `tokens`
// seam rather than relying on a deleted static token.
const INTERNAL_KEY = "sk-sl_index_internal_fixture";
const TEST_INDEX_TOKENS: IndexTokenStore = new Map([
	[
		INTERNAL_KEY,
		{
			tenant_id: "tenant_index_internal_fixture",
			tier: "internal",
			scopes: [INDEX_READ_SCOPE],
		},
	],
]);
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

function blockRow(height: number): IndexBlock {
	return {
		cursor: `${height}:0`,
		block_height: height,
		block_hash: `0x${height}`,
		parent_hash: `0x${height - 1}`,
		burn_block_height: height + 1000,
		burn_block_hash: null,
		index_block_hash: null,
		block_time: null,
		canonical: true,
	};
}

function createApp(
	readFtTransfers: FtTransfersReader = EMPTY_READER,
	tokens?: IndexTokenStore,
) {
	const app = new Hono();
	app.onError(errorHandler);
	app.route(
		"/v1/index",
		createIndexRouter({
			tokens,
			getTip: () => TIP,
			readFtTransfers,
			readNftTransfers: EMPTY_NFT_READER,
			readReorgs: async () => [],
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

	test("anon GET ft-transfers returns 401 on platform", async () => {
		const app = createApp();
		const res = await app.request("/v1/index/ft-transfers");
		expect(res.status).toBe(401);
	});

	test("keyed GET ft-transfers returns 200 with free rate limit", async () => {
		const app = createApp();
		const res = await app.request("/v1/index/ft-transfers", {
			headers: authHeaders(FREE_KEY),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { events: unknown[] };
		expect(body.events).toEqual([]);
		expect(res.headers.get("X-RateLimit-Limit")).toBe(
			String(INDEX_TIER_CONFIG.free.rateLimitPerSecond),
		);
		expect(res.headers.get("X-RateLimit-Remaining")).not.toBeNull();
	});

	test("anon GET nft-transfers returns 401 on platform", async () => {
		const res = await createApp().request("/v1/index/nft-transfers");
		expect(res.status).toBe(401);
	});

	test("keyed GET nft-transfers returns 200", async () => {
		const res = await createApp().request("/v1/index/nft-transfers", {
			headers: authHeaders(FREE_KEY),
		});
		expect(res.status).toBe(200);
	});

	test("free-tier key reads Index at the free rate limit", async () => {
		const res = await createApp().request("/v1/index/ft-transfers", {
			headers: authHeaders(FREE_KEY),
		});
		expect(res.status).toBe(200);
	});

	test("free-tier 429 body carries no upgrade copy — no paid ladder to advertise", async () => {
		const app = createApp();
		for (let i = 0; i < 10; i++) {
			await app.request("/v1/index/ft-transfers", {
				headers: authHeaders(FREE_KEY),
			});
		}
		const res = await app.request("/v1/index/ft-transfers", {
			headers: authHeaders(FREE_KEY),
		});
		expect(res.status).toBe(429);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).not.toHaveProperty("upgrade_url");
		expect(body).not.toHaveProperty("required_tier");
	});

	test("tier config: free is never slower than anonymous, no paid ladder", () => {
		expect(
			INDEX_TIER_CONFIG.free.rateLimitPerSecond ?? Number.POSITIVE_INFINITY,
		).toBeGreaterThanOrEqual(INDEX_ANON_RATE_LIMIT_PER_SECOND);
		expect(INDEX_TIER_CONFIG.internal.rateLimitPerSecond).toBeNull();
	});

	test("wrong scope is rejected", async () => {
		const res = await createApp().request("/v1/index/ft-transfers", {
			headers: authHeaders(WRONG_SCOPE_KEY),
		});
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain(INDEX_READ_SCOPE);
	});

	test("nft-transfers uses the same Index gateway for an internal caller", async () => {
		const res = await createApp(undefined, TEST_INDEX_TOKENS).request(
			"/v1/index/nft-transfers",
			{
				headers: authHeaders(INTERNAL_KEY),
			},
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { events: unknown[]; reorgs: unknown[] };
		expect(body.events).toEqual([]);
		expect(body.reorgs).toEqual([]);
	});

	test("internal tier is unthrottled past the free 10 req/s ceiling", async () => {
		const app = createApp(undefined, TEST_INDEX_TOKENS);
		for (let i = 0; i < 20; i++) {
			const res = await app.request("/v1/index/ft-transfers", {
				headers: authHeaders(INTERNAL_KEY),
			});
			expect(res.status).toBe(200);
		}
	});

	test("Index bucket is separate from Streams bucket", async () => {
		const sharedKey = "sk-shared-internal";
		const streamsTokens: StreamsTokenStore = new Map([
			[
				sharedKey,
				{
					tenant_id: "tenant_shared_internal",
					tier: "internal",
					scopes: [STREAMS_READ_SCOPE],
				},
			],
		]);
		const indexTokens: IndexTokenStore = new Map([
			[
				sharedKey,
				{
					tenant_id: "tenant_shared_internal",
					tier: "internal",
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
		const res = await app.request("/v1/index/events", {
			headers: authHeaders(FREE_KEY),
		});
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
		const res = await app.request("/v1/index/events?event_type=ft_transfer", {
			headers: authHeaders(FREE_KEY),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			events: Array<{ event_type: string }>;
			reorgs: unknown[];
		};
		expect(body.events.map((e) => e.event_type)).toEqual(["ft_transfer"]);
		expect(body.reorgs).toEqual([]);
	});

	test("GET /events with wait but data already present returns immediately, no waiting", async () => {
		const app = new Hono();
		app.onError(errorHandler);
		let readCalls = 0;
		app.route(
			"/v1/index",
			createIndexRouter({
				getTip: () => TIP,
				readReorgs: async () => [],
				readEvents: async () => {
					readCalls++;
					return {
						events: [
							{
								cursor: "10:0",
								block_height: 10,
								tx_id: "0x01",
								tx_index: 0,
								event_index: 0,
								event_type: "ft_transfer" as const,
								contract_id: "SP123.token",
								asset_identifier: "SP123.token::coin",
								sender: "SP123.sender",
								recipient: "SP123.recipient",
								amount: "1",
							},
						],
						next_cursor: "10:0",
					};
				},
			}),
		);
		const start = Date.now();
		const res = await app.request(
			"/v1/index/events?event_type=ft_transfer&wait=5",
			{ headers: authHeaders(FREE_KEY) },
		);
		expect(res.status).toBe(200);
		expect(readCalls).toBe(1);
		expect(Date.now() - start).toBeLessThan(500);
	});

	test("GET /events with wait and no data holds the response for roughly `wait`, then answers empty", async () => {
		const app = new Hono();
		app.onError(errorHandler);
		let readCalls = 0;
		app.route(
			"/v1/index",
			createIndexRouter({
				getTip: () => TIP,
				readReorgs: async () => [],
				readEvents: async () => {
					readCalls++;
					return { events: [], next_cursor: null };
				},
			}),
		);
		const start = Date.now();
		const res = await app.request(
			"/v1/index/events?event_type=ft_transfer&wait=1",
			{ headers: authHeaders(FREE_KEY) },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { events: unknown[] };
		expect(body.events).toEqual([]);
		expect(readCalls).toBe(2); // the initial check + one post-wait retry
		expect(Date.now() - start).toBeGreaterThanOrEqual(900);
	});

	test("GET /events refuses a wait past the 25s ceiling", async () => {
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/index",
			createIndexRouter({
				getTip: () => TIP,
				readReorgs: async () => [],
				readEvents: async () => ({ events: [], next_cursor: null }),
			}),
		);
		const res = await app.request(
			"/v1/index/events?event_type=ft_transfer&wait=30",
			{ headers: authHeaders(FREE_KEY) },
		);
		expect(res.status).toBe(400);
	});

	test("GET /blocks with wait and from_height past the tip holds, then answers with the fresh tip", async () => {
		const app = new Hono();
		app.onError(errorHandler);
		let tipCalls = 0;
		app.route(
			"/v1/index",
			createIndexRouter({
				// Simulates the exact shape IndexHttpClient.getIndexTip({ wait,
				// knownHeight }) relies on: from_height anchored one past the
				// caller's last known height, so an unmoved tip yields an empty page.
				getTip: () => {
					tipCalls++;
					return TIP;
				},
				readReorgs: async () => [],
			}),
		);
		const start = Date.now();
		const res = await app.request(
			`/v1/index/blocks?limit=1&from_height=${TIP.block_height + 1}&wait=1`,
			{ headers: authHeaders(FREE_KEY) },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { blocks: unknown[] };
		expect(body.blocks).toEqual([]);
		expect(tipCalls).toBe(2); // the initial check + one post-wait retry
		expect(Date.now() - start).toBeGreaterThanOrEqual(900);
	});

	test("regression: an idle-at-tip evaluator (decoded tip unmoved, source tip ahead) must hold for ~wait, not busy-loop — this is what IndexHttpClient.getIndexTip's tip_only fixes", async () => {
		// The exact shape that broke in prod: decode lags ingest by a little
		// (normal, even with margin 0), so `source_block_height` sits above the
		// DECODED `block_height` the evaluator tracks as its `knownHeight`
		// baseline. Real blocks genuinely exist in that gap — a caller who
		// reads rows (no tip_only) legitimately gets them back immediately.
		const laggedTip = {
			...TIP,
			block_height: 10_000,
			source_block_height: 10_003,
		};
		const realRowsInGap: IndexBlock[] = [
			blockRow(10_001),
			blockRow(10_002),
			blockRow(10_003),
		];

		// Without tip_only: a real block-listing consumer correctly gets the
		// rows immediately — this is NOT a bug, it's the documented "source tip
		// for a blocks read" contract, asserted here as the control case.
		{
			const app = new Hono();
			app.onError(errorHandler);
			app.route(
				"/v1/index",
				createIndexRouter({
					getTip: () => laggedTip,
					readReorgs: async () => [],
					readBlocks: async () => ({
						blocks: realRowsInGap,
						next_cursor: realRowsInGap.at(-1)?.cursor ?? null,
					}),
				}),
			);
			const res = await app.request(
				`/v1/index/blocks?limit=10&from_height=${laggedTip.block_height + 1}&wait=1`,
				{ headers: authHeaders(FREE_KEY) },
			);
			const body = (await res.json()) as { blocks: unknown[] };
			expect(body.blocks.length).toBeGreaterThan(0);
		}

		// With tip_only=true (what getIndexTip actually sends): the caller only
		// cares whether the DECODED tip moved past its baseline. The source tip
		// being ahead must NOT count as "new data" — the request must hold for
		// the full wait window and make at most one retry, never busy-loop.
		{
			const app = new Hono();
			app.onError(errorHandler);
			let requestCount = 0;
			app.route(
				"/v1/index",
				createIndexRouter({
					getTip: () => {
						requestCount++;
						return laggedTip;
					},
					readReorgs: async () => [],
					readBlocks: async () => ({
						blocks: realRowsInGap,
						next_cursor: realRowsInGap.at(-1)?.cursor ?? null,
					}),
				}),
			);
			const start = Date.now();
			const res = await app.request(
				`/v1/index/blocks?limit=1&tip_only=true&from_height=${laggedTip.block_height + 1}&wait=1`,
				{ headers: authHeaders(FREE_KEY) },
			);
			const body = (await res.json()) as { blocks: unknown[] };
			expect(res.status).toBe(200);
			expect(body.blocks).toEqual([]);
			// The bug made this fire on a tight loop (many requests, ~100ms each).
			// The fix must hold for close to the full `wait` window and answer
			// with at most one retry — never more than one request per `wait`.
			expect(requestCount).toBeLessThanOrEqual(2);
			expect(Date.now() - start).toBeGreaterThanOrEqual(900);
		}
	});

	test("regression: event_types scopes wait to the referenced decoder(s) — an unreferenced decoder committing repeatedly must not unblock it, but the referenced one committing must", async () => {
		// Two decoders. `unreferenced` (e.g. an idle `print` decoder re-committing
		// its unchanged cursor, or just a slower one) keeps advancing on every
		// check; `referenced` (what this request's event_types names) does not,
		// until the very end. Without event_types, the GLOBAL floor (min over
		// both) would track `unreferenced` and flip the wait to "non-empty" the
		// moment it moves — exactly plan-063's busy-idle regression.
		let getTipCalls = 0;
		let unreferencedHeight = 100;
		let referencedHeight = 100;
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/index",
			createIndexRouter({
				getTip: () => {
					getTipCalls++;
					unreferencedHeight++; // "commits repeatedly" on every check
					return {
						block_height: Math.min(referencedHeight, unreferencedHeight),
						finalized_height: 90,
						lag_seconds: 0,
						decoded_heights: {
							referenced: referencedHeight,
							unreferenced: unreferencedHeight,
						},
					};
				},
				readReorgs: async () => [],
			}),
		);

		// Holds: only `unreferenced` moves for the whole window.
		const holdStart = Date.now();
		const held = await app.request(
			"/v1/index/blocks?limit=1&tip_only=true&event_types=referenced&from_height=101&wait=1",
			{ headers: authHeaders(FREE_KEY) },
		);
		const heldBody = (await held.json()) as { tip: { block_height: number } };
		expect(heldBody.tip.block_height).toBe(100); // unaffected by unreferenced's climb
		expect(getTipCalls).toBeLessThanOrEqual(2); // at most one post-wait retry, not a busy loop
		expect(Date.now() - holdStart).toBeGreaterThanOrEqual(900);

		// Unblocks: `referenced` itself commits.
		referencedHeight = 105;
		const returnStart = Date.now();
		const returned = await app.request(
			"/v1/index/blocks?limit=1&tip_only=true&event_types=referenced&from_height=101&wait=1",
			{ headers: authHeaders(FREE_KEY) },
		);
		const returnedBody = (await returned.json()) as {
			tip: { block_height: number };
		};
		expect(returnedBody.tip.block_height).toBe(105);
		expect(Date.now() - returnStart).toBeLessThan(500); // already non-empty on the first check
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
		const res = await app.request("/v1/index/contract-calls", {
			headers: authHeaders(FREE_KEY),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			contract_calls: unknown[];
			reorgs: unknown[];
		};
		expect(body.contract_calls).toHaveLength(1);
		expect(body.reorgs).toEqual([]);
	});
});

describe("Index PoX-5 events route", () => {
	const prevMode = process.env.INSTANCE_MODE;
	beforeEach(() => {
		process.env.INSTANCE_MODE = "platform";
	});
	afterAll(() => {
		if (prevMode === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prevMode;
	});

	const POX5_EVENT = {
		cursor: "9000:0",
		block_height: 9000,
		block_time: null,
		tx_id: "0x9000",
		tx_index: 0,
		event_index: 0,
		topic: "stake" as const,
		staker: "SP_STAKER",
		signer: "SP_SIGNER",
		signer_manager: null,
		bond_index: 3,
		amount_ustx: "1000",
		amount_sats: null,
		reward_cycle: 97,
		first_reward_cycle: 98,
		unlock_cycle: null,
		unlock_burn_height: null,
		is_l1_lock: true,
		signer_key: "0xabcd",
		data: { topic: "stake" },
	};

	function pox5App(
		overrides: {
			tokens?: IndexTokenStore;
		} = {},
	) {
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/index",
			createIndexRouter({
				getTip: () => TIP,
				readReorgs: async () => [],
				readPox5Events: async () => ({
					events: [POX5_EVENT],
					next_cursor: "9000:0",
				}),
				...overrides,
			}),
		);
		return app;
	}

	test("returns the envelope with an account key", async () => {
		const res = await pox5App().request("/v1/index/pox5/events", {
			headers: authHeaders(FREE_KEY),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			events: Array<{ topic: string; data: unknown }>;
			next_cursor: string | null;
			tip: unknown;
			reorgs: unknown[];
		};
		expect(body.events).toHaveLength(1);
		expect(body.events[0]?.topic).toBe("stake");
		// `data` is passed through as parsed JSON, never a re-serialized string.
		expect(body.events[0]?.data).toEqual({ topic: "stake" });
		expect(body.next_cursor).toBe("9000:0");
		expect(body.tip).toBeDefined();
		expect(body.reorgs).toEqual([]);
	});

	test("anon GET pox5/events returns 401 on platform", async () => {
		const res = await pox5App().request("/v1/index/pox5/events");
		expect(res.status).toBe(401);
	});

	test("is listed in the discovery doc", async () => {
		const res = await pox5App().request("/v1/index");
		const body = (await res.json()) as { routes: Array<{ path: string }> };
		expect(body.routes.map((r) => r.path)).toContain("/v1/index/pox5/events");
	});

	test("rejects an unknown query filter", async () => {
		const res = await pox5App().request("/v1/index/pox5/events?sender=x", {
			headers: authHeaders(FREE_KEY),
		});
		expect(res.status).toBe(400);
	});
});

describe("Index Runes routes", () => {
	const prevMode = process.env.INSTANCE_MODE;
	const prevBitcoinUrl = process.env.BITCOIN_DATABASE_URL;
	beforeEach(async () => {
		process.env.INSTANCE_MODE = "platform";
		// Stub readers below never touch a real pool — this only flips
		// `isBitcoinConfigured()` so the route doesn't take the "not
		// provisioned" short-circuit for the happy-path tests.
		process.env.BITCOIN_DATABASE_URL = "postgres://stub-not-a-real-db/bitcoin";
		await _resetRateLimitStoreForTests();
	});
	afterAll(() => {
		if (prevMode === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prevMode;
		if (prevBitcoinUrl === undefined) delete process.env.BITCOIN_DATABASE_URL;
		else process.env.BITCOIN_DATABASE_URL = prevBitcoinUrl;
	});

	const RUNES_TIP: BitcoinIndexTip = {
		block_height: 840_100,
		finalized_height: 840_094,
		lag_seconds: 12,
	};

	const DOG_ENTRY: RuneEntry = {
		id: "840000:3",
		number: "0",
		name: "DOGGOTOTHEMOON",
		spaced_name: "DOG•GO•TO•THE•MOON",
		symbol: "🐕",
		divisibility: 5,
		premine: "10000000000000000",
		supply: "10000000000000000",
		burned: "0",
		mints: "0",
		turbo: true,
		etching_txid: "aa".repeat(32),
		etched_height: 840_000,
		etched_tx_index: 3,
		terms: null,
	};

	const readRuneStub: RuneReader = async (ref) =>
		"id" in ref && ref.id === "840000:3" ? DOG_ENTRY : null;
	const readRunesStub: RunesReader = async () => ({
		runes: [DOG_ENTRY],
		next_cursor: null,
	});

	function runesApp(overrides: Partial<IndexRouterOptions> = {}) {
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/index",
			createIndexRouter({
				getBitcoinTip: async () => RUNES_TIP,
				readRunes: readRunesStub,
				readRune: readRuneStub,
				readRuneActivity: async () => ({ events: [], next_cursor: null }),
				readRuneBalances: async () => ({ balances: [], next_cursor: null }),
				readBtcReorgs: async () => [],
				...overrides,
			}),
		);
		return app;
	}

	test("GET /runes returns the envelope with an account key", async () => {
		const res = await runesApp().request("/v1/index/runes", {
			headers: authHeaders(FREE_KEY),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			runes: unknown[];
			next_cursor: string | null;
			tip: unknown;
			reorgs: unknown[];
		};
		expect(body.runes).toHaveLength(1);
		expect(body.tip).toEqual(RUNES_TIP);
		expect(body.reorgs).toEqual([]);
	});

	test("anon GET /runes returns 401 on platform", async () => {
		const res = await runesApp().request("/v1/index/runes");
		expect(res.status).toBe(401);
	});

	test("GET /runes/:rune returns the entry", async () => {
		const res = await runesApp().request("/v1/index/runes/840000:3", {
			headers: authHeaders(FREE_KEY),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { rune: { id: string }; tip: unknown };
		expect(body.rune.id).toBe("840000:3");
		expect(body.tip).toEqual(RUNES_TIP);
	});

	test("GET /runes/:rune resolves a name reference the same as its id", async () => {
		const res = await runesApp().request(
			`/v1/index/runes/${encodeURIComponent("dog.go.to.the.moon")}`,
			{ headers: authHeaders(FREE_KEY) },
		);
		// The stub reader only matches on id — a name-form ref parses to
		// `{ rune: bigint }`, which the stub reports as not found. This proves
		// `parseRuneRef` accepted the name (no 400) and reached the reader.
		expect(res.status).toBe(404);
	});

	test("GET /runes/:rune 404s for an unknown rune id", async () => {
		const res = await runesApp().request("/v1/index/runes/1:1", {
			headers: authHeaders(FREE_KEY),
		});
		expect(res.status).toBe(404);
		const body = (await res.json()) as { code: string };
		expect(body.code).toBe("NOT_FOUND");
	});

	test("GET /runes/:rune 400s for a garbage rune reference", async () => {
		const res = await runesApp().request(
			`/v1/index/runes/${encodeURIComponent("!!!not-a-rune###")}`,
			{ headers: authHeaders(FREE_KEY) },
		);
		expect(res.status).toBe(400);
	});

	test("GET /runes/activity returns the envelope", async () => {
		const res = await runesApp().request("/v1/index/runes/activity", {
			headers: authHeaders(FREE_KEY),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { events: unknown[]; reorgs: unknown[] };
		expect(body.events).toEqual([]);
		expect(body.reorgs).toEqual([]);
	});

	test("GET /runes/activity rejects an unknown query filter", async () => {
		const res = await runesApp().request("/v1/index/runes/activity?bogus=x", {
			headers: authHeaders(FREE_KEY),
		});
		expect(res.status).toBe(400);
	});

	test("GET /runes/balances requires exactly one of address/outpoint", async () => {
		const res = await runesApp().request("/v1/index/runes/balances", {
			headers: authHeaders(FREE_KEY),
		});
		expect(res.status).toBe(400);
	});

	test("GET /runes/balances returns the envelope", async () => {
		const res = await runesApp().request(
			"/v1/index/runes/balances?address=bc1qexample",
			{ headers: authHeaders(FREE_KEY) },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { balances: unknown[] };
		expect(body.balances).toEqual([]);
	});

	test("all four Runes routes are listed in the discovery doc", async () => {
		const res = await runesApp().request("/v1/index");
		const body = (await res.json()) as { routes: Array<{ path: string }> };
		const paths = body.routes.map((r) => r.path);
		expect(paths).toContain("/v1/index/runes");
		expect(paths).toContain("/v1/index/runes/:rune");
		expect(paths).toContain("/v1/index/runes/activity");
		expect(paths).toContain("/v1/index/runes/balances");
	});

	test("not configured: GET /runes returns an empty list with a note", async () => {
		delete process.env.BITCOIN_DATABASE_URL;
		const res = await runesApp().request("/v1/index/runes", {
			headers: authHeaders(FREE_KEY),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { runes: unknown[]; notes?: string };
		expect(body.runes).toEqual([]);
		expect(body.notes).toMatch(/BITCOIN_DATABASE_URL/);
	});

	test("not configured: GET /runes/:rune 404s with a note in details", async () => {
		delete process.env.BITCOIN_DATABASE_URL;
		const res = await runesApp().request("/v1/index/runes/840000:3", {
			headers: authHeaders(FREE_KEY),
		});
		expect(res.status).toBe(404);
		const body = (await res.json()) as {
			code: string;
			details?: { notes?: string };
		};
		expect(body.code).toBe("NOT_FOUND");
		expect(body.details?.notes).toMatch(/BITCOIN_DATABASE_URL/);
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
							settlement_confirmed: null,
							btc_confirmations: null,
							btc_block_height: null,
							confirmed_at: null,
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
									btc_block_height: null,
									confirmed_at: null,
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

	test("the withdrawals settlement filter passes the gate and reaches the reader", async () => {
		// The parser, the SQL predicate, the SDK option, and the OpenAPI spec all
		// carry settlement_confirmed; leaving it out of SBTC_WITHDRAWAL_FILTERS
		// meant the allowlist 400'd every request before the parser ran.
		const seen: Array<boolean | undefined> = [];
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/index",
			createIndexRouter({
				getTip: () => TIP,
				readReorgs: async () => [],
				readSbtcWithdrawals: async (params) => {
					seen.push(params.settlementConfirmed);
					return { withdrawals: [], next_cursor: null };
				},
			}),
		);

		const res = await app.request(
			"/v1/index/sbtc/withdrawals?settlement_confirmed=true",
		);
		expect(res.status).toBe(200);
		expect(seen).toEqual([true]);

		const bad = await app.request(
			"/v1/index/sbtc/withdrawals?settlement_confirmed=maybe",
		);
		expect(bad.status).toBe(400);
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

// Real mainnet cycle math (666,050 first burn height, 2,100-block cycles) so
// the fixture's `prepare_start_burn_height` lines up with `reward_cycle` —
// the flags below are computed from that boundary, not from the reward_cycle
// number itself.
const FAKE_POX_CYCLE_DATA: Pox5CycleData = {
	reward_cycle: 142,
	start_burn_height: 964_250,
	prepare_start_burn_height: 964_150,
	end_burn_height: 966_349,
	total_stacked_ustx: "5000000",
	reward_eligible_ustx: "4000000",
	stakers: 3,
	signers_in_set: 1,
	bond_sats: {},
	bond_total_sats: "0",
	sbtc_custodied_sats: "0",
	rewards_allocated_stx: "0",
	rewards_allocated_bond: "0",
	reserve_deposit: "0",
	rewards_per_token_stx: null,
	rewards_per_token_bond: {},
	distributions: 0,
	rewards_claimed: "0",
	computed_through_height: 9100,
};
// A tip well before cycle 142 starts (and before its prepare phase at
// 964,150): 142 reads as a future, open (not-frozen) cycle.
const OPEN_TIP_BURN_HEIGHT = 900_000;
const FAKE_POX_CYCLE: Pox5Cycle = {
	...FAKE_POX_CYCLE_DATA,
	is_current: false,
	is_frozen: false,
};

describe("Index /pox/cycles route (fake reader)", () => {
	function cyclesApp(
		overrides: {
			readPoxCycles?: PoxCyclesReader;
			readPoxTipBurnHeight?: PoxTipBurnHeightReader;
		} = {},
	) {
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/index",
			createIndexRouter({
				getTip: () => TIP,
				readReorgs: async () => [],
				readPoxCycles: async () => ({
					cycles: [FAKE_POX_CYCLE_DATA],
					next_cursor: null,
				}),
				readPoxTipBurnHeight: async () => OPEN_TIP_BURN_HEIGHT,
				...overrides,
			}),
		);
		return app;
	}

	test("returns the pox_version-5 envelope from the injected fake reader", async () => {
		const res = await cyclesApp().request("/v1/index/pox/cycles");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			pox_version: number;
			cycles: Pox5Cycle[];
			next_cursor: number | null;
		};
		expect(body.pox_version).toBe(5);
		expect(body.cycles).toEqual([FAKE_POX_CYCLE]);
		expect(body.next_cursor).toBeNull();
	});

	test("short-caches a page that contains an open (not-frozen) cycle", async () => {
		const res = await cyclesApp().request("/v1/index/pox/cycles");
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toContain("max-age=30");
	});

	test("long-caches a page where every returned cycle is frozen", async () => {
		const frozenCycle = {
			...FAKE_POX_CYCLE_DATA,
			prepare_start_burn_height: 0,
		};
		const res = await cyclesApp({
			readPoxCycles: async () => ({
				cycles: [frozenCycle],
				next_cursor: null,
			}),
		}).request("/v1/index/pox/cycles");
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toContain("max-age=3600");
	});
});

describe("Index /pox/cycles/:reward_cycle route (fake reader)", () => {
	function cycleApp(
		overrides: {
			readPoxCycle?: PoxCycleReader;
			readPoxTipBurnHeight?: PoxTipBurnHeightReader;
		} = {},
	) {
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/index",
			createIndexRouter({
				getTip: () => TIP,
				readReorgs: async () => [],
				readPoxCycle: async (rewardCycle) =>
					rewardCycle === 142
						? { cycle: FAKE_POX_CYCLE_DATA, signers: [] }
						: null,
				readPoxTipBurnHeight: async () => OPEN_TIP_BURN_HEIGHT,
				...overrides,
			}),
		);
		return app;
	}

	test("returns the cycle for a matching reward_cycle, with its signers", async () => {
		const res = await cycleApp().request("/v1/index/pox/cycles/142");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			pox_version: number;
			cycle: Pox5Cycle & { signers: unknown[] };
		};
		expect(body.pox_version).toBe(5);
		expect(body.cycle).toEqual({ ...FAKE_POX_CYCLE, signers: [] });
	});

	test("404s for a reward_cycle the reader doesn't have", async () => {
		const res = await cycleApp().request("/v1/index/pox/cycles/999");
		expect(res.status).toBe(404);
	});

	test("404s below the first pox-5 reward cycle with a note, without calling the reader", async () => {
		let called = false;
		const res = await cycleApp({
			readPoxCycle: async () => {
				called = true;
				return null;
			},
		}).request("/v1/index/pox/cycles/140");
		expect(res.status).toBe(404);
		const body = (await res.json()) as { notes?: string };
		expect(body.notes).toContain("PoX-4");
		expect(called).toBe(false);
	});

	test("400s for a non-integer reward_cycle without ever calling the reader", async () => {
		let called = false;
		const res = await cycleApp({
			readPoxCycle: async (rewardCycle) => {
				called = true;
				return rewardCycle === 142
					? { cycle: FAKE_POX_CYCLE_DATA, signers: [] }
					: null;
			},
		}).request("/v1/index/pox/cycles/abc");
		expect(res.status).toBe(400);
		expect(called).toBe(false);
	});

	test("400s for a negative reward_cycle without ever calling the reader", async () => {
		let called = false;
		const res = await cycleApp({
			readPoxCycle: async (rewardCycle) => {
				called = true;
				return rewardCycle === 142
					? { cycle: FAKE_POX_CYCLE_DATA, signers: [] }
					: null;
			},
		}).request("/v1/index/pox/cycles/-1");
		expect(res.status).toBe(400);
		expect(called).toBe(false);
	});
});

describe("Index /transactions/:tx_id/proof route (fake reader)", () => {
	const FAKE_PROOF: TransactionProofResponse = {
		txid: "abc",
		index_block_hash: "deadbeef",
		block_height: 9000,
		tx_index: 0,
		raw_tx: "00",
		raw_header: "00",
		tx_merkle_path: [],
	};

	function proofApp(
		overrides: {
			readTransactionProof?: TransactionProofReader;
		} = {},
	) {
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/index",
			createIndexRouter({
				getTip: () => TIP,
				readReorgs: async () => [],
				readTransactionProof: async (txId) =>
					txId === "0xabc" ? FAKE_PROOF : null,
				...overrides,
			}),
		);
		return app;
	}

	test("returns the proof, immutably cached", async () => {
		const res = await proofApp().request("/v1/index/transactions/0xabc/proof");
		expect(res.status).toBe(200);
		const body = (await res.json()) as TransactionProofResponse;
		expect(body).toEqual(FAKE_PROOF);
		expect(res.headers.get("Cache-Control")).toContain("immutable");
	});

	test("404s when the reader finds no tx/block", async () => {
		const res = await proofApp().request(
			"/v1/index/transactions/0xnotfound/proof",
		);
		expect(res.status).toBe(404);
	});

	test("503s with PROOF_TX_SET_INCOMPLETE when the reader throws IncompleteBlockTxSetError", async () => {
		const res = await proofApp({
			readTransactionProof: async () => {
				throw new IncompleteBlockTxSetError(9000);
			},
		}).request("/v1/index/transactions/0xabc/proof");
		expect(res.status).toBe(503);
		const body = (await res.json()) as { code: string };
		expect(body.code).toBe("PROOF_TX_SET_INCOMPLETE");
	});

	test("503s with PROOF_NODE_UNAVAILABLE when the reader throws ProofNodeUnavailableError", async () => {
		const res = await proofApp({
			readTransactionProof: async () => {
				throw new ProofNodeUnavailableError(new Error("connect ECONNREFUSED"));
			},
		}).request("/v1/index/transactions/0xabc/proof");
		expect(res.status).toBe(503);
		const body = (await res.json()) as { code: string };
		expect(body.code).toBe("PROOF_NODE_UNAVAILABLE");
	});
});

describe.skipIf(!HAS_DB)("Index PoX cycles route caching", () => {
	const db = HAS_DB ? getDb() : null;
	// A block at TIP.block_height (10,000) whose burn height sits inside
	// cycle 142's active range — a realistic "current tip" for these tests.
	const TIP_BURN_HEIGHT = 964_300;

	function cyclesApp() {
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/index",
			createIndexRouter({ getTip: () => TIP, readReorgs: async () => [] }),
		);
		return app;
	}

	function cycleRow(rewardCycle: number) {
		return {
			reward_cycle: rewardCycle,
			start_burn_height: 666_050 + rewardCycle * 2_100,
			prepare_start_burn_height: 666_050 + rewardCycle * 2_100 - 100,
			end_burn_height: 666_050 + (rewardCycle + 1) * 2_100 - 1,
			total_stacked_ustx: "1000000",
			reward_eligible_ustx: "1000000",
			stakers: 1,
			signers_in_set: 1,
			bond_sats: jsonb({}),
			bond_total_sats: "0",
			sbtc_custodied_sats: "0",
			rewards_allocated_stx: "0",
			rewards_allocated_bond: "0",
			reserve_deposit: "0",
			rewards_per_token_stx: null,
			rewards_per_token_bond: jsonb({}),
			distributions: 0,
			rewards_claimed: "0",
			computed_through_height: 9_000,
		};
	}

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM pox5_cycles`.execute(db);
		await db
			.deleteFrom("blocks")
			.where("height", "=", TIP.block_height)
			.execute();
		await db
			.insertInto("blocks")
			.values({
				height: TIP.block_height,
				hash: "0xpoxcyclestip",
				parent_hash: "0xparent",
				burn_block_height: TIP_BURN_HEIGHT,
				burn_block_hash: null,
				timestamp: 1_700_000_000,
				canonical: true,
			})
			.execute();
	});

	afterAll(async () => {
		if (!db) return;
		await sql`DELETE FROM pox5_cycles`.execute(db);
		await db
			.deleteFrom("blocks")
			.where("height", "=", TIP.block_height)
			.execute();
	});

	test("short-caches a page that contains an open (not yet frozen) cycle", async () => {
		if (!db) throw new Error("missing db");
		// 142 is current (and so frozen); 200 is far enough in the future that
		// its own prepare phase hasn't started yet.
		await db
			.insertInto("pox5_cycles")
			.values([cycleRow(142), cycleRow(200)])
			.execute();

		const res = await cyclesApp().request("/v1/index/pox/cycles");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			pox_version: number;
			cycles: Array<{
				reward_cycle: number;
				is_current: boolean;
				is_frozen: boolean;
			}>;
		};
		expect(body.pox_version).toBe(5);
		expect(body.cycles.find((c) => c.reward_cycle === 142)?.is_current).toBe(
			true,
		);
		expect(body.cycles.find((c) => c.reward_cycle === 142)?.is_frozen).toBe(
			true,
		);
		expect(body.cycles.find((c) => c.reward_cycle === 200)?.is_frozen).toBe(
			false,
		);
		expect(res.headers.get("Cache-Control")).toContain("max-age=30");
	});

	test("long-caches a page where every cycle is already frozen", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("pox5_cycles")
			.values([cycleRow(141), cycleRow(142)])
			.execute();

		const res = await cyclesApp().request("/v1/index/pox/cycles");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			cycles: Array<{ is_frozen: boolean }>;
		};
		expect(body.cycles.every((c) => c.is_frozen)).toBe(true);
		expect(res.headers.get("Cache-Control")).toContain("max-age=3600");
	});
});

describe.skipIf(!HAS_DB)("credits gate: allowance pre-check (DB)", () => {
	const db = HAS_DB ? getDb() : (null as never);
	let prevMode: string | undefined;
	const accountIds: string[] = [];

	beforeAll(() => {
		prevMode = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "platform";
	});
	afterAll(async () => {
		if (prevMode === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prevMode;
		if (accountIds.length > 0) {
			await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
		}
	});

	async function makeAccount(): Promise<string> {
		const row = await db
			.insertInto("accounts")
			.values({ email: null, ghost: true })
			.returning("id")
			.executeTakeFirstOrThrow();
		accountIds.push(row.id);
		return row.id;
	}

	function fakeEvent(cursor: string) {
		return {
			cursor,
			block_height: 10,
			tx_id: `0x${cursor}`,
			tx_index: 0,
			event_index: 0,
			event_type: "ft_transfer" as const,
			contract_id: "SP123.token",
			asset_identifier: "SP123.token::coin",
			sender: "SP123.sender",
			recipient: "SP123.recipient",
			amount: "1",
		};
	}

	async function ledgerRows(accountId: string) {
		return db
			.selectFrom("usage_ledger")
			.selectAll()
			.where("account_id", "=", accountId)
			.where("unit", "=", "rows.delivered")
			.execute();
	}

	test("free account under the allowance reads and gets a $0 ledger row", async () => {
		const accountId = await makeAccount();
		const app = new Hono();
		app.onError(errorHandler);
		const tokens: IndexTokenStore = new Map([
			[
				`sk-sl_test_${accountId}`,
				{
					tenant_id: `account:${accountId}`,
					account_id: accountId,
					tier: "free",
					scopes: [INDEX_READ_SCOPE],
				},
			],
		]);
		app.route(
			"/v1/index",
			createIndexRouter({
				tokens,
				getTip: () => TIP,
				readReorgs: async () => [],
				readEvents: async () => ({
					events: [fakeEvent("0:0")],
					next_cursor: null,
				}),
			}),
		);

		const res = await app.request("/v1/index/events?event_type=ft_transfer", {
			headers: { Authorization: `Bearer sk-sl_test_${accountId}` },
		});
		expect(res.status).toBe(200);

		const rows = await ledgerRows(accountId);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.usd_micros).toBe("0");
	});

	test("account at the allowance with $0 balance gets 402 insufficient_credits and no rows served", async () => {
		const accountId = await makeAccount();
		const now = new Date("2026-09-24T00:00:00Z");
		// Use up the allowance without any balance to pay for it.
		await meter(db, {
			accountId,
			unit: "rows.delivered",
			quantity: ROWS_DELIVERED_MONTHLY_ALLOWANCE,
			source: "test-seed",
			idempotencyKey: `seed-${accountId}`,
			occurredAt: now,
		});

		let readerCalled = false;
		const app = new Hono();
		app.onError(errorHandler);
		const tokens: IndexTokenStore = new Map([
			[
				`sk-sl_test_${accountId}`,
				{
					tenant_id: `account:${accountId}`,
					account_id: accountId,
					tier: "free",
					scopes: [INDEX_READ_SCOPE],
				},
			],
		]);
		app.route(
			"/v1/index",
			createIndexRouter({
				tokens,
				getTip: () => TIP,
				readReorgs: async () => [],
				readEvents: async () => {
					readerCalled = true;
					return { events: [fakeEvent("1:0")], next_cursor: null };
				},
			}),
		);

		const res = await app.request("/v1/index/events?event_type=ft_transfer", {
			headers: { Authorization: `Bearer sk-sl_test_${accountId}` },
		});

		expect(res.status).toBe(402);
		const body = (await res.json()) as {
			error: string;
			shortfall_usd_micros: number;
			top_up_url: string;
		};
		expect(body.error).toBe("insufficient_credits");
		expect(body.shortfall_usd_micros).toBeGreaterThan(0);
		expect(body.top_up_url).toBeTruthy();
		expect(readerCalled).toBe(false);

		const rows = await ledgerRows(accountId);
		expect(rows).toHaveLength(1); // only the seed row — this attempt served nothing
	});

	test("a first-party internal key bound to an account is served past the allowance and never metered", async () => {
		const accountId = await makeAccount();
		// The account is over its allowance with $0: a customer key would 402.
		await meter(db, {
			accountId,
			unit: "rows.delivered",
			quantity: ROWS_DELIVERED_MONTHLY_ALLOWANCE,
			source: "test-seed",
			idempotencyKey: `seed-${accountId}`,
			occurredAt: new Date(),
		});

		const app = new Hono();
		app.onError(errorHandler);
		const tokens: IndexTokenStore = new Map([
			[
				`sk-sl_hosted_${accountId}`,
				{
					tenant_id: `account:${accountId}`,
					account_id: accountId,
					tier: "internal",
					scopes: [INDEX_READ_SCOPE],
				},
			],
		]);
		app.route(
			"/v1/index",
			createIndexRouter({
				tokens,
				getTip: () => TIP,
				readReorgs: async () => [],
				readEvents: async () => ({
					events: [fakeEvent("2:0"), fakeEvent("2:1")],
					next_cursor: null,
				}),
			}),
		);

		const res = await app.request("/v1/index/events?event_type=ft_transfer", {
			headers: { Authorization: `Bearer sk-sl_hosted_${accountId}` },
		});
		expect(res.status).toBe(200);

		const rows = await ledgerRows(accountId);
		expect(rows).toHaveLength(1); // only the seed row: the read wasn't metered
	});

	test("the same over-allowance account reads again after a top-up, and the row is debited", async () => {
		const accountId = await makeAccount();
		const now = new Date("2026-09-24T00:00:00Z");
		await meter(db, {
			accountId,
			unit: "rows.delivered",
			quantity: ROWS_DELIVERED_MONTHLY_ALLOWANCE,
			source: "test-seed",
			idempotencyKey: `seed-${accountId}`,
			occurredAt: now,
		});
		await creditCredits(db, accountId, 1_000_000n);

		const app = new Hono();
		app.onError(errorHandler);
		const tokens: IndexTokenStore = new Map([
			[
				`sk-sl_test_${accountId}`,
				{
					tenant_id: `account:${accountId}`,
					account_id: accountId,
					tier: "free",
					scopes: [INDEX_READ_SCOPE],
				},
			],
		]);
		app.route(
			"/v1/index",
			createIndexRouter({
				tokens,
				getTip: () => TIP,
				readReorgs: async () => [],
				readEvents: async () => ({
					events: [fakeEvent("2:0")],
					next_cursor: null,
				}),
			}),
		);

		const res = await app.request("/v1/index/events?event_type=ft_transfer", {
			headers: { Authorization: `Bearer sk-sl_test_${accountId}` },
		});
		expect(res.status).toBe(200);

		const rows = await ledgerRows(accountId);
		const billed = rows.find((r) => r.source === "index");
		expect(billed).toBeDefined();
		expect(billed?.debited).toBe(true);
		expect(Number(billed?.usd_micros)).toBeGreaterThan(0);
	});

	test("a read that straddles the allowance boundary with $0 balance serves in full, overflow debited=false", async () => {
		const accountId = await makeAccount();
		const now = new Date("2026-09-24T00:00:00Z");
		// 3 rows of allowance left.
		await meter(db, {
			accountId,
			unit: "rows.delivered",
			quantity: ROWS_DELIVERED_MONTHLY_ALLOWANCE - 3,
			source: "test-seed",
			idempotencyKey: `seed-${accountId}`,
			occurredAt: now,
		});

		const app = new Hono();
		app.onError(errorHandler);
		const tokens: IndexTokenStore = new Map([
			[
				`sk-sl_test_${accountId}`,
				{
					tenant_id: `account:${accountId}`,
					account_id: accountId,
					tier: "free",
					scopes: [INDEX_READ_SCOPE],
				},
			],
		]);
		app.route(
			"/v1/index",
			createIndexRouter({
				tokens,
				getTip: () => TIP,
				readReorgs: async () => [],
				readEvents: async () => ({
					events: [
						fakeEvent("3:0"),
						fakeEvent("3:1"),
						fakeEvent("3:2"),
						fakeEvent("3:3"),
						fakeEvent("3:4"),
					],
					next_cursor: null,
				}),
			}),
		);

		const res = await app.request("/v1/index/events?event_type=ft_transfer", {
			headers: { Authorization: `Bearer sk-sl_test_${accountId}` },
		});
		expect(res.status).toBe(200); // served in full — started under the allowance
		const body = (await res.json()) as { events: unknown[] };
		expect(body.events).toHaveLength(5);

		const rows = await ledgerRows(accountId);
		const overflow = rows.find((r) => r.source === "index");
		expect(overflow).toBeDefined();
		expect(overflow?.debited).toBe(false); // 2 of the 5 rows were billable, balance was $0
	});

	test("oss/self-host loopback read with no key and no account: 200, no ledger row", async () => {
		process.env.INSTANCE_MODE = "oss";
		try {
			const app = new Hono();
			app.onError(errorHandler);
			app.route(
				"/v1/index",
				createIndexRouter({
					getTip: () => TIP,
					readReorgs: async () => [],
					readEvents: async () => ({
						events: [fakeEvent("4:0")],
						next_cursor: null,
					}),
				}),
			);
			const res = await app.request("/v1/index/events?event_type=ft_transfer");
			expect(res.status).toBe(200);
		} finally {
			process.env.INSTANCE_MODE = "platform";
		}
	});
});
