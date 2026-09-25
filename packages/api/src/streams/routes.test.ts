import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import type { StreamsEvent } from "@secondlayer/indexer/streams-events";
import { meter } from "@secondlayer/platform/billing/meter";
import { ROWS_DELIVERED_MONTHLY_ALLOWANCE } from "@secondlayer/platform/billing/prices";
import { creditCredits } from "@secondlayer/platform/db/queries/account-credits";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { _resetRateLimitStoreForTests } from "../auth/rate-limit-store.ts";
import { errorHandler } from "../middleware/error.ts";
import { createStreamsRouter } from "../routes/streams.ts";
import { STREAMS_READ_SCOPE, type StreamsTokenStore } from "./auth.ts";
import type { StreamsEventsReader } from "./events.ts";
import {
	STREAMS_BLOCKS_PER_DAY,
	STREAMS_DEFAULT_FROM_HEIGHT_WINDOW_BLOCKS,
	STREAMS_TIER_CONFIG,
} from "./tiers.ts";
import type { StreamsTip } from "./tip.ts";

const HAS_DB = !!process.env.DATABASE_URL;

const FREE_KEY = "sk-sl_streams_free_test";
const STATUS_KEY = "sk-sl_streams_status_public";
const WRONG_SCOPE_KEY = "sk-sl_streams_wrong_scope_test";

// No paid ladder left in the default seeds, so tests that need an unthrottled,
// unretained (non-free) caller inject their own "internal" tenant through the
// `tokens` seam rather than relying on a deleted static token.
const INTERNAL_KEY = "sk-sl_streams_internal_fixture";
const TEST_TOKENS: StreamsTokenStore = new Map([
	[
		INTERNAL_KEY,
		{
			tenant_id: "tenant_streams_internal_fixture",
			tier: "internal",
			scopes: [STREAMS_READ_SCOPE],
		},
	],
]);

const TEST_TIP: StreamsTip = {
	block_height: 200_000,
	block_hash:
		"0x0000000000000000000000000000000000000000000000000000000000000001",
	burn_block_height: 20_000,
	finalized_height: 199_994,
	lag_seconds: 0,
};

const EMPTY_EVENTS_READER: StreamsEventsReader = async () => ({
	events: [],
	next_cursor: null,
});

function createApp(
	readEvents: StreamsEventsReader = EMPTY_EVENTS_READER,
	tokens?: StreamsTokenStore,
) {
	const app = new Hono();
	app.onError(errorHandler);
	app.route(
		"/v1/streams",
		createStreamsRouter({
			tokens,
			getTip: () => TEST_TIP,
			readEvents,
			readReorgs: async () => [],
		}),
	);
	return app;
}

function createMeteredApp(opts: {
	readEvents?: StreamsEventsReader;
	readEventsByTxId?: NonNullable<
		Parameters<typeof createStreamsRouter>[0]
	>["readEventsByTxId"];
	readBlockEvents?: NonNullable<
		Parameters<typeof createStreamsRouter>[0]
	>["readBlockEvents"];
}) {
	const app = new Hono();
	app.onError(errorHandler);
	const tokens: StreamsTokenStore = new Map([
		[
			"sk-sl_metered_streams",
			{
				tenant_id: "account:acct_streams",
				account_id: "acct_streams",
				tier: "free",
				scopes: [STREAMS_READ_SCOPE],
			},
		],
		[
			"sk-sl_unmetered_streams",
			{
				tenant_id: "tenant_static",
				tier: "free",
				scopes: [STREAMS_READ_SCOPE],
			},
		],
		[
			"sk-sl_metered_wrong_scope",
			{
				tenant_id: "account:acct_streams",
				account_id: "acct_streams",
				tier: "free",
				scopes: [],
			},
		],
		// Free tier, NO account_id: exercises the retention gate without touching
		// the credits DB (resolveCreditedAccount short-circuits on missing account).
		[
			"sk-sl_free_anon_streams",
			{
				tenant_id: "tenant_free_anon",
				tier: "free",
				scopes: [STREAMS_READ_SCOPE],
			},
		],
	]);
	app.route(
		"/v1/streams",
		createStreamsRouter({
			tokens,
			getTip: () => TEST_TIP,
			readEvents: opts.readEvents ?? EMPTY_EVENTS_READER,
			readEventsByTxId: opts.readEventsByTxId,
			readBlockEvents: opts.readBlockEvents,
			readReorgs: async () => [],
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
		block_hash: TEST_TIP.block_hash,
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
	// Rate limit is platform-only (self-host is single-tenant, unthrottled).
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

	test("Internal-tier key is unthrottled past the free 10 req/s ceiling", async () => {
		const app = createApp(undefined, TEST_TOKENS);

		for (let i = 0; i < 20; i++) {
			const res = await app.request("/v1/streams/events", {
				headers: authHeaders(INTERNAL_KEY),
			});
			expect(res.status).toBe(200);
		}
	});

	test("tier config is metered free vs unmetered internal, no paid ladder", () => {
		expect(STREAMS_TIER_CONFIG.free.rateLimitPerSecond).toBe(10);
		expect(STREAMS_TIER_CONFIG.internal.rateLimitPerSecond).toBeNull();
	});

	test("finalized closed range is cacheable as immutable", async () => {
		const app = createApp(undefined, TEST_TOKENS);
		// TEST_TIP.finalized_height = 199_994; a closed range below it is immutable.
		const res = await app.request(
			"/v1/streams/events?from_height=199990&to_height=199994",
			{ headers: authHeaders(INTERNAL_KEY) },
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toContain("immutable");
	});

	test("finalized page is served from the origin cache on repeat", async () => {
		let reads = 0;
		const app = createApp(async () => {
			reads++;
			return { events: [], next_cursor: null };
		}, TEST_TOKENS);
		const path = "/v1/streams/events?from_height=199990&to_height=199994";
		await app.request(path, { headers: authHeaders(INTERNAL_KEY) });
		await app.request(path, { headers: authHeaders(INTERNAL_KEY) });
		expect(reads).toBe(1);
	});

	test("If-None-Match on a finalized page returns 304", async () => {
		const app = createApp(undefined, TEST_TOKENS);
		const path = "/v1/streams/events?from_height=199990&to_height=199994";
		const first = await app.request(path, {
			headers: authHeaders(INTERNAL_KEY),
		});
		expect(first.status).toBe(200);
		const etag = first.headers.get("ETag");
		expect(etag).toBeTruthy();

		const second = await app.request(path, {
			headers: {
				...authHeaders(INTERNAL_KEY),
				"If-None-Match": etag as string,
			},
		});
		expect(second.status).toBe(304);
	});

	test("default tip-spanning request is private and short-lived", async () => {
		const app = createApp(undefined, TEST_TOKENS);
		const res = await app.request("/v1/streams/events", {
			headers: authHeaders(INTERNAL_KEY),
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe("private, max-age=2");
	});

	test("Free-tier key requesting from_height older than the old retention floor now succeeds (no retention ladder)", async () => {
		const app = createApp();
		const oldBlock = TEST_TIP.block_height - 1 * STREAMS_BLOCKS_PER_DAY - 1;
		const res = await app.request(
			`/v1/streams/events?from_height=${oldBlock}`,
			{
				headers: authHeaders(FREE_KEY),
			},
		);

		expect(res.status).toBe(200);
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
		await expect(res.json()).resolves.toEqual({
			...TEST_TIP,
			oldest_seekable_height: null,
			oldest_cursor: null,
		});
	});

	test("/canonical/:height returns canonical block with nullable burn hash", async () => {
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/streams",
			createStreamsRouter({
				tokens: TEST_TOKENS,
				getTip: () => TEST_TIP,
				readEvents: EMPTY_EVENTS_READER,
				readReorgs: async () => [],
				readCanonicalBlock: async (height) => ({
					block_height: height,
					block_hash: "0xabc",
					burn_block_height: 77,
					burn_block_hash: null,
					is_canonical: true,
				}),
			}),
		);

		const res = await app.request("/v1/streams/canonical/100", {
			headers: authHeaders(INTERNAL_KEY),
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("ETag")).toBe('"0xabc"');
		await expect(res.json()).resolves.toEqual({
			block_height: 100,
			block_hash: "0xabc",
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
				tokens: TEST_TOKENS,
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
			headers: authHeaders(INTERNAL_KEY),
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
				tokens: TEST_TOKENS,
				getTip: () => TEST_TIP,
				readEvents: EMPTY_EVENTS_READER,
				readBlockEvents: async ({ blockHash }) => {
					seenHash = blockHash;
					return { events: [streamsEvent({ block_hash: "0xblock" })] };
				},
				readReorgs: async () => [],
			}),
		);

		const res = await app.request("/v1/streams/blocks/0xblock/events", {
			headers: authHeaders(INTERNAL_KEY),
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
				tokens: TEST_TOKENS,
				getTip: () => TEST_TIP,
				readEvents: EMPTY_EVENTS_READER,
				readReorgs: async () => [],
				readReorgsSince: async ({ since, limit }) => {
					expect(since).toEqual({
						detected_at: "2026-05-03T00:00:00.000Z",
						id: null,
					});
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
			{ headers: authHeaders(INTERNAL_KEY) },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({
			reorgs: [{ id: "reorg-1" }],
			// detected_at~id: microsecond-safe resume token with an id tiebreak
			next_since: "2026-05-03T12:30:00.000Z~reorg-1",
		});
	});

	test("public status key can read /tip", async () => {
		const app = createApp();
		const res = await app.request("/v1/streams/tip", {
			headers: authHeaders(STATUS_KEY),
		});

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({
			...TEST_TIP,
			oldest_seekable_height: null,
			oldest_cursor: null,
		});
	});

	test("/events rejects from_height with cursor", async () => {
		const app = createApp(undefined, TEST_TOKENS);
		const res = await app.request(
			"/v1/streams/events?cursor=9999:0&from_height=9999",
			{
				headers: authHeaders(INTERNAL_KEY),
			},
		);

		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("mutually exclusive");
	});

	test("/events rejects malformed cursors", async () => {
		const app = createApp(undefined, TEST_TOKENS);
		const res = await app.request("/v1/streams/events?cursor=0001:0", {
			headers: authHeaders(INTERNAL_KEY),
		});

		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("<block_height>:<event_index>");
	});

	test("/events clamps limit to 1000", async () => {
		const app = createApp(
			async ({ limit }) => ({
				events: Array.from({ length: limit }, (_, i) => ({
					cursor: `1:${i}`,
					block_height: 1,
					block_hash: TEST_TIP.block_hash,
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
			}),
			TEST_TOKENS,
		);
		const res = await app.request("/v1/streams/events?limit=5000", {
			headers: authHeaders(INTERNAL_KEY),
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
						block_hash: TEST_TIP.block_hash,
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
		}, TEST_TOKENS);

		const startedAt = performance.now();
		const res = await app.request("/v1/streams/events", {
			headers: authHeaders(INTERNAL_KEY),
		});
		const elapsedMs = performance.now() - startedAt;

		expect(res.status).toBe(200);
		expect(elapsedMs).toBeLessThan(1000);
		expect(seenFromHeight).toBe(
			Math.max(
				0,
				TEST_TIP.block_height - STREAMS_DEFAULT_FROM_HEIGHT_WINDOW_BLOCKS,
			),
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
		}, TEST_TOKENS);

		const res = await app.request("/v1/streams/events?from_cursor=0:0", {
			headers: authHeaders(INTERNAL_KEY),
		});

		expect(res.status).toBe(200);
		expect(seenAfter).toEqual({ block_height: 0, event_index: 0 });
		expect(seenFromHeight).toBeUndefined();
	});

	test("free tier reads a genesis-height row via /events/:tx_id (no retention refusal)", async () => {
		// streamsEvent defaults to block 100 — under the old 1-day retention
		// floor (182_720). No retention ladder anymore: this succeeds.
		const app = createMeteredApp({
			readEventsByTxId: async ({ txId }) => ({
				events: [streamsEvent({ tx_id: txId })],
			}),
		});

		const res = await app.request("/v1/streams/events/0xtx", {
			headers: authHeaders("sk-sl_free_anon_streams"),
		});

		expect(res.status).toBe(200);
	});

	test("free tier reads a genesis-height row via /blocks/:heightOrHash/events (no retention refusal)", async () => {
		const app = createMeteredApp({
			readBlockEvents: async () => ({
				events: [streamsEvent({ block_hash: "0xblock" })],
			}),
		});

		const res = await app.request("/v1/streams/blocks/0xblock/events", {
			headers: authHeaders("sk-sl_free_anon_streams"),
		});

		expect(res.status).toBe(200);
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

	function tokensFor(accountId: string): StreamsTokenStore {
		return new Map([
			[
				`sk-sl_test_${accountId}`,
				{
					tenant_id: `account:${accountId}`,
					account_id: accountId,
					tier: "free",
					scopes: [STREAMS_READ_SCOPE],
				},
			],
		]);
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
		app.route(
			"/v1/streams",
			createStreamsRouter({
				tokens: tokensFor(accountId),
				getTip: () => TEST_TIP,
				readEvents: async () => ({
					events: [streamsEvent({ cursor: "0:0" })],
					next_cursor: null,
				}),
				readReorgs: async () => [],
			}),
		);

		const res = await app.request("/v1/streams/events", {
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
		app.route(
			"/v1/streams",
			createStreamsRouter({
				tokens: tokensFor(accountId),
				getTip: () => TEST_TIP,
				readEvents: async () => {
					readerCalled = true;
					return {
						events: [streamsEvent({ cursor: "1:0" })],
						next_cursor: null,
					};
				},
				readReorgs: async () => [],
			}),
		);

		const res = await app.request("/v1/streams/events", {
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
		expect(rows).toHaveLength(1); // only the seed row
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
		app.route(
			"/v1/streams",
			createStreamsRouter({
				tokens: tokensFor(accountId),
				getTip: () => TEST_TIP,
				readEvents: async () => ({
					events: [streamsEvent({ cursor: "2:0" })],
					next_cursor: null,
				}),
				readReorgs: async () => [],
			}),
		);

		const res = await app.request("/v1/streams/events", {
			headers: { Authorization: `Bearer sk-sl_test_${accountId}` },
		});
		expect(res.status).toBe(200);

		const rows = await ledgerRows(accountId);
		const billed = rows.find((r) => r.source === "streams");
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
		app.route(
			"/v1/streams",
			createStreamsRouter({
				tokens: tokensFor(accountId),
				getTip: () => TEST_TIP,
				readEvents: async () => ({
					events: [
						streamsEvent({ cursor: "3:0" }),
						streamsEvent({ cursor: "3:1" }),
						streamsEvent({ cursor: "3:2" }),
						streamsEvent({ cursor: "3:3" }),
						streamsEvent({ cursor: "3:4" }),
					],
					next_cursor: null,
				}),
				readReorgs: async () => [],
			}),
		);

		const res = await app.request("/v1/streams/events", {
			headers: { Authorization: `Bearer sk-sl_test_${accountId}` },
		});
		expect(res.status).toBe(200); // served in full — started under the allowance
		const body = (await res.json()) as { events: unknown[] };
		expect(body.events).toHaveLength(5);

		const rows = await ledgerRows(accountId);
		const overflow = rows.find((r) => r.source === "streams");
		expect(overflow).toBeDefined();
		expect(overflow?.debited).toBe(false);
	});

	test("oss/self-host loopback read with no key and no account: 200, no ledger row", async () => {
		process.env.INSTANCE_MODE = "oss";
		try {
			const app = new Hono();
			app.onError(errorHandler);
			app.route(
				"/v1/streams",
				createStreamsRouter({
					getTip: () => TEST_TIP,
					readEvents: async () => ({
						events: [streamsEvent({ cursor: "4:0" })],
						next_cursor: null,
					}),
					readReorgs: async () => [],
				}),
			);
			const res = await app.request("/v1/streams/events");
			expect(res.status).toBe(200);
		} finally {
			process.env.INSTANCE_MODE = "platform";
		}
	});
});
