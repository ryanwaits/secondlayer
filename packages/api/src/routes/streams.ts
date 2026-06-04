import {
	type ReadStreamsBlockEventsParams,
	type ReadStreamsEventsByTxIdParams,
	type ReadStreamsEventsListResult,
	readCanonicalStreamsBlockEvents,
	readCanonicalStreamsEventsByTxId,
} from "@secondlayer/indexer/streams-events";
import {
	getProductUsage,
	incrementStreamsEventsReturned,
} from "@secondlayer/platform/db/queries/usage";
import { DECODED_EVENT_TYPES } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { validateQueryParams } from "../middleware/validation.ts";
import {
	DEFAULT_STREAMS_TOKEN_STORE,
	type StreamsEnv,
	type StreamsTokenStore,
	streamsBearerAuth,
} from "../streams/auth.ts";
import {
	STREAMS_IMMUTABLE_CACHE_CONTROL,
	isFinalizedHeight,
	matchesIfNoneMatch,
	streamsCacheControl,
	streamsETag,
	streamsEventsCachePlan,
} from "../streams/cache.ts";
import {
	type StreamsCanonicalBlockReader,
	parseStreamsHeight,
	readCanonicalStreamsBlock,
} from "../streams/canonical.ts";
import {
	type StreamsEventsReader,
	getStreamsEventsResponse,
	markFinalized,
} from "../streams/events.ts";
import { streamsRateLimit } from "../streams/rate-limit.ts";
import {
	DEFAULT_STREAMS_REORGS_READER,
	DEFAULT_STREAMS_REORGS_SINCE_READER,
	type StreamsReorgsReader,
	type StreamsReorgsSinceReader,
	getStreamsReorgsListResponse,
} from "../streams/reorgs.ts";
import { StreamsResponseCache } from "../streams/response-cache.ts";
import { streamsRetentionWindow } from "../streams/retention.ts";
import { respondSignedJson } from "../streams/signing.ts";
import { STREAMS_TIER_CONFIG } from "../streams/tiers.ts";
import { type StreamsTipProvider, getStreamsTip } from "../streams/tip.ts";

const STREAMS_EVENTS_ALLOWED = [
	"cursor",
	"from_cursor",
	"from_height",
	"to_height",
	"types",
	"not_types",
	"contract_id",
	"sender",
	"recipient",
	"asset_identifier",
	"limit",
] as const;
const STREAMS_REORGS_ALLOWED = ["since", "limit"] as const;

// Machine-readable filter spec for GET /v1/streams discovery (name + type).
const STREAMS_EVENTS_FILTER_SPEC = [
	{
		name: "types",
		type: "event_type[]",
		description: "Event types to include",
	},
	{
		name: "not_types",
		type: "event_type[]",
		description: "Event types to exclude (applied after types)",
	},
	{ name: "contract_id", type: "principal | comma-list" },
	{ name: "sender", type: "principal | comma-list" },
	{ name: "recipient", type: "principal | comma-list" },
	{ name: "asset_identifier", type: "string" },
	{ name: "from_height", type: "number" },
	{ name: "to_height", type: "number" },
	{ name: "cursor", type: "string" },
	{ name: "from_cursor", type: "string" },
	{ name: "limit", type: "number (max 1000)" },
] as const;

export type StreamsRouterOptions = {
	tokens?: StreamsTokenStore;
	getTip?: StreamsTipProvider;
	readEvents?: StreamsEventsReader;
	readEventsByTxId?: (
		params: ReadStreamsEventsByTxIdParams,
	) => Promise<ReadStreamsEventsListResult>;
	readBlockEvents?: (
		params: ReadStreamsBlockEventsParams,
	) => Promise<ReadStreamsEventsListResult>;
	readCanonicalBlock?: StreamsCanonicalBlockReader;
	readReorgs?: StreamsReorgsReader;
	readReorgsSince?: StreamsReorgsSinceReader;
	recordEventsReturned?: (accountId: string, quantity: number) => Promise<void>;
	responseCache?: StreamsResponseCache;
};

export function createStreamsRouter(opts: StreamsRouterOptions = {}) {
	const getTip = opts.getTip ?? getStreamsTip;
	const readReorgs = opts.readReorgs ?? DEFAULT_STREAMS_REORGS_READER;
	// One cache per router: a single shared instance in production (the router is
	// built once at startup), and isolated per app in tests.
	const responseCache = opts.responseCache ?? new StreamsResponseCache();
	const recordEventsReturned =
		opts.recordEventsReturned ??
		((accountId, quantity) =>
			incrementStreamsEventsReturned(getDb(), accountId, quantity));
	const router = new Hono<StreamsEnv>();

	// Discovery endpoint — anonymous, lists routes + envelope shape.
	router.get("/", (c) =>
		c.json({
			routes: [
				{
					path: "/v1/streams/events",
					method: "GET",
					description:
						"Raw event firehose. Cursor-paginated. Returns events[], next_cursor, tip, reorgs[].",
					event_types: DECODED_EVENT_TYPES,
					filters: STREAMS_EVENTS_FILTER_SPEC,
					auth: "bearer (Build+ tier)",
				},
				{
					path: "/v1/streams/reorgs",
					method: "GET",
					description: "Chain reorg history. since=<iso|cursor>.",
					filters: ["since", "limit"],
					auth: "bearer (Build+ tier)",
				},
				{
					path: "/v1/streams/canonical/:height",
					method: "GET",
					description: "Single canonical block by height.",
				},
				{
					path: "/v1/streams/events/:tx_id",
					method: "GET",
					description: "All events for one transaction.",
				},
				{
					path: "/v1/streams/blocks/:heightOrHash/events",
					method: "GET",
					description: "Events for a single block.",
				},
				{
					path: "/v1/streams/tip",
					method: "GET",
					description:
						"Current chain tip: { block_height, block_hash, burn_block_height, finalized_height, lag_seconds }.",
				},
				{
					path: "/v1/streams/usage",
					method: "GET",
					description:
						"Your own Streams consumption (events today + this month) and tier limits (rate limit, retention).",
					auth: "bearer (Build+ tier)",
				},
			],
			cursor: {
				format: "<block_height>:<event_index>",
				semantics:
					"opaque resume token; pass back unchanged to continue. Equals last event's cursor (inclusive on output, exclusive on input).",
			},
			reorgs_shape: {
				detected_at: "ISO 8601",
				new_canonical_tip: "<block_height>:<event_index>",
				new_canonical_height: "number",
				new_canonical_event_index: "number",
			},
		}),
	);

	router.use(
		"*",
		streamsBearerAuth({ tokens: opts.tokens ?? DEFAULT_STREAMS_TOKEN_STORE }),
	);
	router.use("*", streamsRateLimit());
	router.use("/events", streamsRetentionWindow({ getTip }));

	// An agent's own Streams consumption + tier limits. Streams is key-mandatory,
	// so account_id is always present here; guard anyway.
	router.get("/usage", async (c) => {
		const tenant = c.get("streamsTenant");
		if (!tenant.account_id) {
			return c.json({ error: "Usage requires an API key", code: "AUTH" }, 401);
		}
		const usage = await getProductUsage(getDb(), tenant.account_id);
		const limits = STREAMS_TIER_CONFIG[tenant.tier];
		return c.json({
			product: "streams",
			tier: tenant.tier,
			limits: {
				rate_limit_per_second: limits.rateLimitPerSecond,
				retention_days: limits.retentionDays,
			},
			usage: {
				events_today: usage.streamsEventsToday,
				events_this_month: usage.streamsEventsThisMonth,
			},
		});
	});

	router.get("/events", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, STREAMS_EVENTS_ALLOWED);
		const tip = c.get("streamsTip");
		const { cacheControl, cacheKey } = streamsEventsCachePlan(query, tip);
		c.header("Cache-Control", cacheControl);

		// Finalized pages are immutable: serve the memoized payload (Postgres skip)
		// and attach the fresh tip. Rate-limit/metering still run per request.
		const cached = cacheKey ? responseCache.get(cacheKey) : undefined;
		const response = cached
			? { ...cached, tip }
			: await getStreamsEventsResponse({
					query,
					tip,
					readEvents: opts.readEvents,
					readReorgs,
				});
		if (cacheKey && !cached) {
			responseCache.set(cacheKey, {
				events: response.events,
				next_cursor: response.next_cursor,
				reorgs: response.reorgs,
			});
		}
		// Immutable pages get an ETag over the stable slice only (not the moving
		// tip), so it survives tip movement. A matching If-None-Match short-circuits
		// to 304 before metering, since the client already holds the data.
		if (cacheControl === STREAMS_IMMUTABLE_CACHE_CONTROL) {
			const etag = streamsETag(
				JSON.stringify({
					events: response.events,
					next_cursor: response.next_cursor,
					reorgs: response.reorgs,
				}),
			);
			c.header("ETag", etag);
			if (matchesIfNoneMatch(c.req.header("If-None-Match"), etag)) {
				return c.body(null, 304);
			}
		}
		const accountId = c.get("streamsTenant").account_id;
		if (accountId && response.events.length > 0) {
			await recordEventsReturned(accountId, response.events.length);
		}
		return respondSignedJson(c, response);
	});

	router.get("/canonical/:height", async (c) => {
		const height = parseStreamsHeight(c.req.param("height"));
		const readCanonicalBlock =
			opts.readCanonicalBlock ?? readCanonicalStreamsBlock;
		const block = await readCanonicalBlock(height);
		if (!block) {
			return c.json({ error: "Canonical block not found" }, 404);
		}
		const tip = await getTip();
		const etag = `"${block.block_hash}"`;
		c.header("ETag", etag);
		c.header(
			"Cache-Control",
			streamsCacheControl(isFinalizedHeight(height, tip)),
		);
		if (matchesIfNoneMatch(c.req.header("If-None-Match"), etag)) {
			return c.body(null, 304);
		}
		return respondSignedJson(c, block);
	});

	router.get("/events/:tx_id", async (c) => {
		const txId = c.req.param("tx_id");
		if (!txId) return c.json({ error: "tx_id is required" }, 400);
		const tip = await getTip();
		const readEventsByTxId =
			opts.readEventsByTxId ?? readCanonicalStreamsEventsByTxId;
		const result = await readEventsByTxId({ txId });
		if (result.events.length === 0) {
			return c.json({ error: "Transaction events not found" }, 404);
		}
		const firstEvent = result.events[0];
		const lastEvent = result.events.at(-1);
		const reorgs =
			firstEvent && lastEvent
				? await readReorgs({
						from: {
							block_height: firstEvent.block_height,
							event_index: firstEvent.event_index,
						},
						to: {
							block_height: lastEvent.block_height,
							event_index: lastEvent.event_index,
						},
					})
				: [];
		c.header(
			"Cache-Control",
			streamsCacheControl(isFinalizedHeight(lastEvent?.block_height, tip)),
		);
		return respondSignedJson(c, {
			events: markFinalized(result.events, tip.finalized_height),
			tip,
			reorgs,
		});
	});

	router.get("/blocks/:heightOrHash/events", async (c) => {
		const heightOrHash = c.req.param("heightOrHash");
		const byHeight = /^(0|[1-9]\d*)$/.test(heightOrHash)
			? parseStreamsHeight(heightOrHash, "heightOrHash")
			: undefined;
		if (byHeight === undefined && heightOrHash.length === 0) {
			return c.json({ error: "heightOrHash is required" }, 400);
		}

		const tip = await getTip();
		const readBlockEvents =
			opts.readBlockEvents ?? readCanonicalStreamsBlockEvents;
		const result = await readBlockEvents(
			byHeight === undefined
				? { blockHash: heightOrHash }
				: { blockHeight: byHeight },
		);
		if (result.events.length === 0) {
			return c.json({ error: "Block events not found" }, 404);
		}
		const firstEvent = result.events[0];
		const lastEvent = result.events.at(-1);
		const reorgs =
			firstEvent && lastEvent
				? await readReorgs({
						from: {
							block_height: firstEvent.block_height,
							event_index: firstEvent.event_index,
						},
						to: {
							block_height: lastEvent.block_height,
							event_index: lastEvent.event_index,
						},
					})
				: [];
		c.header(
			"Cache-Control",
			streamsCacheControl(isFinalizedHeight(firstEvent?.block_height, tip)),
		);
		return respondSignedJson(c, {
			events: markFinalized(result.events, tip.finalized_height),
			tip,
			reorgs,
		});
	});

	router.get("/reorgs", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, STREAMS_REORGS_ALLOWED);
		const response = await getStreamsReorgsListResponse({
			query,
			readReorgsSince:
				opts.readReorgsSince ?? DEFAULT_STREAMS_REORGS_SINCE_READER,
		});
		return respondSignedJson(c, response);
	});

	router.get("/tip", async (c) => {
		c.header("Cache-Control", streamsCacheControl(false));
		return respondSignedJson(c, await getTip());
	});

	return router;
}

export default createStreamsRouter();
