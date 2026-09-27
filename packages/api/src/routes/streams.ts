import {
	type ReadStreamsBlockEventsParams,
	type ReadStreamsEventsByTxIdParams,
	type ReadStreamsEventsListResult,
	readCanonicalStreamsBlockEvents,
	readCanonicalStreamsEventsByTxId,
} from "@secondlayer/indexer/streams-events";
import { DECODED_EVENT_TYPES } from "@secondlayer/shared";
import { ValidationError } from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { validateQueryParams } from "../middleware/validation.ts";
import {
	DEFAULT_STREAMS_TOKEN_STORE,
	type StreamsEnv,
	type StreamsTokenStore,
	streamsBearerAuth,
} from "../streams/auth.ts";
import {
	type ReadStreamsBitcoinBlockEventsParams,
	type ReadStreamsBitcoinEventsByTxIdParams,
	type ReadStreamsBitcoinEventsListResult,
	type StreamsBitcoinEventsReader,
	type StreamsBitcoinReorgsSinceParams,
	type StreamsBitcoinTipProvider,
	encodeBitcoinReorgsNextSince,
	getStreamsBitcoinEventsResponse,
	getStreamsBitcoinTip,
	markBitcoinFinalized,
	readStreamsBitcoinBlockEvents,
	readStreamsBitcoinCanonicalBlock,
	readStreamsBitcoinEventsByTxId,
	readStreamsBitcoinReorgs,
	readStreamsBitcoinReorgsSince,
} from "../streams/bitcoin.ts";
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
	debitStreamsCreditedRead,
	streamsCreditsGate,
} from "../streams/credits-gate.ts";
import {
	type StreamsEventsReader,
	getClampedStreamsTipHeight,
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
import { getStreamsSigner, respondSignedJson } from "../streams/signing.ts";
import { type StreamsTipProvider, getStreamsTip } from "../streams/tip.ts";

const STREAMS_EVENTS_ALLOWED = [
	"cursor",
	"from_cursor",
	"from_height",
	"to_height",
	"types",
	// Alias for a single-value `types` — the Index spelling, honored here.
	"event_type",
	"not_types",
	"contract_id",
	"sender",
	"recipient",
	"asset_identifier",
	"filters",
	"limit",
	"clock",
	// chain=bitcoin (plan 059): a separate cursor space, own filter vocabulary.
	"chain",
	"rune",
	"address",
] as const;
const STREAMS_REORGS_ALLOWED = ["since", "limit", "chain"] as const;
/** Every non-`/events` route's query surface is just the chain switch. */
const STREAMS_CHAIN_ONLY_ALLOWED = ["chain"] as const;

export type StreamsChain = "stacks" | "bitcoin";

/** `chain=` on every Streams route (plan 059): `stacks` (default, unchanged
 *  cursor/response shape) or `bitcoin` (Runes events, its own cursor space —
 *  see `../streams/bitcoin.ts`). */
function resolveStreamsChain(query: URLSearchParams): StreamsChain {
	const raw = query.get("chain");
	if (raw === null || raw === "stacks") return "stacks";
	if (raw === "bitcoin") return "bitcoin";
	throw new ValidationError('chain must be "stacks" or "bitcoin"');
}

// SSE tail cadence: poll the forward cursor every `POLL_MS`, and emit a `ping`
// keepalive after `HEARTBEAT_MS` of no events.
const STREAMS_SSE_POLL_MS = Number(process.env.STREAMS_SSE_POLL_MS) || 1500;
const STREAMS_SSE_HEARTBEAT_MS = 20_000;

// Machine-readable filter spec for GET /v1/streams discovery (name + type).
const STREAMS_EVENTS_FILTER_SPEC = [
	{
		name: "types",
		type: "event_type[]",
		description: "Event types to include",
	},
	{
		name: "clock",
		type: "classic | vm",
		description: "classic is Streams 1.0 (event_index). vm is ordinal.",
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
	{
		name: "filters",
		type: "json object of label -> filter",
		description:
			"Labelled filter groups; groups OR together and each event echoes the labels it matched",
	},
	{ name: "from_height", type: "number" },
	{ name: "to_height", type: "number" },
	{ name: "cursor", type: "string" },
	{ name: "from_cursor", type: "string" },
	{ name: "limit", type: "number (max 1000)" },
	{
		name: "chain",
		type: "stacks | bitcoin",
		description:
			"stacks (default) or bitcoin (Runes events, own cursor space). See the top-level chain field.",
	},
	{
		name: "rune",
		type: "string",
		description:
			"chain=bitcoin only: a RuneRef, id (840000:3) or name (DOG•GO•TO•THE•MOON)",
	},
	{
		name: "address",
		type: "string",
		description: "chain=bitcoin only: a mainnet address",
	},
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
	responseCache?: StreamsResponseCache;
	// chain=bitcoin (plan 059) — mirrors the Stacks options above, own readers
	// since it's a separate Postgres (`packages/bitcoin`, D18).
	getBitcoinTip?: StreamsBitcoinTipProvider;
	readBitcoinEvents?: StreamsBitcoinEventsReader;
	readBitcoinEventsByTxId?: (
		params: ReadStreamsBitcoinEventsByTxIdParams,
	) => Promise<ReadStreamsBitcoinEventsListResult>;
	readBitcoinBlockEvents?: (
		params: ReadStreamsBitcoinBlockEventsParams,
	) => Promise<ReadStreamsBitcoinEventsListResult>;
	readBitcoinCanonicalBlock?: typeof readStreamsBitcoinCanonicalBlock;
	readBitcoinReorgs?: StreamsReorgsReader;
	readBitcoinReorgsSince?: (
		params: StreamsBitcoinReorgsSinceParams,
	) => ReturnType<typeof readStreamsBitcoinReorgsSince>;
};

export function createStreamsRouter(opts: StreamsRouterOptions = {}) {
	const getTip = opts.getTip ?? getStreamsTip;
	const readReorgs = opts.readReorgs ?? DEFAULT_STREAMS_REORGS_READER;
	const getBitcoinTip = opts.getBitcoinTip ?? getStreamsBitcoinTip;
	const readBitcoinReorgs = opts.readBitcoinReorgs ?? readStreamsBitcoinReorgs;
	// One cache per router: a single shared instance in production (the router is
	// built once at startup), and isolated per app in tests.
	const responseCache = opts.responseCache ?? new StreamsResponseCache();
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
					auth: "bearer required, metered per row",
				},
				{
					path: "/v1/streams/reorgs",
					method: "GET",
					description:
						"Chain reorg history. since=<iso|cursor>. chain=stacks|bitcoin.",
					filters: ["since", "limit", "chain"],
					auth: "bearer required, metered per row",
				},
				{
					path: "/v1/streams/canonical/:height",
					method: "GET",
					description:
						"Single canonical block by height. chain=bitcoin returns the btc block hash.",
				},
				{
					path: "/v1/streams/events/:tx_id",
					method: "GET",
					description: "All events for one transaction. chain=stacks|bitcoin.",
				},
				{
					path: "/v1/streams/blocks/:heightOrHash/events",
					method: "GET",
					description: "Events for a single block. chain=stacks|bitcoin.",
				},
				{
					path: "/v1/streams/tip",
					method: "GET",
					description:
						"Current chain tip. chain=stacks (default): { block_height, block_hash, burn_block_height, finalized_height, lag_seconds }. chain=bitcoin: { block_height, block_hash, finalized_height, lag_seconds }.",
				},
			],
			cursor: {
				format: "<block_height>:<event_index>",
				semantics:
					"opaque resume token; pass back unchanged to continue. Equals last event's cursor (inclusive on output, exclusive on input). Per-chain: a cursor from chain=bitcoin only resumes with chain=bitcoin, and vice versa.",
			},
			chain: {
				param: "chain",
				values: ["stacks", "bitcoin"],
				default: "stacks",
				description:
					"stacks (default) is the existing Stacks feed, unchanged. bitcoin serves Runes events (rune_etch, rune_mint, rune_transfer, rune_burn) with its own cursor space; filters rune=<id|name> and address= replace contract_id/sender/recipient/asset_identifier/filters, which are Stacks-only. clock=vm is Stacks-only too.",
			},
			reorgs_shape: {
				detected_at: "ISO 8601",
				new_canonical_tip: "<block_height>:<event_index>",
				new_canonical_height: "number",
				new_canonical_event_index: "number",
			},
		}),
	);

	// Streams reads follow the same rule as Index and subgraphs: open on a
	// loopback bind, instance token past it. (It was key-mandatory in every
	// mode, which contradicted every doc page and left the internal decoder
	// key as the only credential a caller could actually use.)
	router.use(
		"*",
		streamsBearerAuth({ tokens: opts.tokens ?? DEFAULT_STREAMS_TOKEN_STORE }),
	);
	// Credits gate: a free account with a prepaid balance goes unthrottled —
	// flags the request so the rate limiter lets it through; the post-read
	// step meters every row (allowance + any debit inside `meter()`). Runs
	// after auth, before the rate limiter.
	router.use("*", streamsCreditsGate());
	router.use("*", streamsRateLimit());
	// No retention floor: every account reads full history. Still
	// sets `streamsTip` for the /events handler below.
	router.use("/events", async (c, next) => {
		c.set("streamsTip", await getTip());
		await next();
	});

	router.get("/events", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, STREAMS_EVENTS_ALLOWED);
		const chain = resolveStreamsChain(query);
		if (chain === "bitcoin") {
			// No response-cache/ETag optimization on this path (v1) — Runes
			// volume is far lower than the Stacks firehose, and the Stacks
			// default path above is untouched either way.
			const tip = await getBitcoinTip();
			c.header("Cache-Control", streamsCacheControl(false));
			const response = await getStreamsBitcoinEventsResponse({
				query,
				tip,
				readEvents: opts.readBitcoinEvents,
				readReorgs: readBitcoinReorgs,
			});
			const accountId = c.get("streamsTenant")?.account_id;
			if (accountId && response.events.length > 0) {
				await debitStreamsCreditedRead(c, response.events);
			}
			return respondSignedJson(c, response);
		}
		const tip = c.get("streamsTip");
		const tier = c.get("streamsTenant")?.tier;
		const { cacheControl, cacheKey } = streamsEventsCachePlan(query, tip, tier);
		c.header("Cache-Control", cacheControl);

		// Finalized pages are immutable: serve the memoized payload (Postgres skip)
		// and attach the fresh tip. Rate-limit/metering still run per request.
		const cached = cacheKey ? responseCache.get(cacheKey) : undefined;
		const response = cached
			? { ...cached, tip }
			: await getStreamsEventsResponse({
					query,
					tip,
					tier,
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
		const accountId = c.get("streamsTenant")?.account_id;
		if (accountId && response.events.length > 0) {
			await debitStreamsCreditedRead(c, response.events);
		}
		return respondSignedJson(c, response);
	});

	// Real-time push: an SSE poll-loop wrapped in `text/event-stream`. Keeps the
	// immutable/cacheable event model (it's the same forward cursor read), but
	// pushes new canonical events at poll cadence instead of the SDK long-poll.
	// Registered before `/events/:tx_id` so "stream" isn't parsed as a tx_id.
	router.get("/events/stream", async (c) => {
		const initialQuery = new URL(c.req.url).searchParams;
		validateQueryParams(initialQuery, STREAMS_EVENTS_ALLOWED);
		const chain = resolveStreamsChain(initialQuery);
		const accountId = c.get("streamsTenant")?.account_id;
		const tier = c.get("streamsTenant")?.tier;
		const signer = getStreamsSigner();

		// Filters carry across polls; the start position (cursor/from_*) is replaced
		// by the running cursor once we've delivered anything.
		const filterParams = new URLSearchParams(initialQuery);
		for (const k of ["cursor", "from_cursor", "from_height"]) {
			filterParams.delete(k);
		}
		const hasStart = ["cursor", "from_cursor", "from_height"].some((k) =>
			initialQuery.has(k),
		);

		return streamSSE(c, async (stream) => {
			let pollQuery = initialQuery;
			let initialized = hasStart;
			let lastBeat = Date.now();
			while (!stream.aborted) {
				let response: Awaited<
					ReturnType<
						| typeof getStreamsEventsResponse
						| typeof getStreamsBitcoinEventsResponse
					>
				>;
				if (chain === "bitcoin") {
					const tip = await getBitcoinTip();
					if (!initialized) {
						// No start given → live-tail from the current tip. Bitcoin has no
						// reorg-margin clamp (see `../streams/bitcoin.ts`'s module doc).
						const q = new URLSearchParams(filterParams);
						q.set("from_height", String(tip.block_height));
						pollQuery = q;
						initialized = true;
					}
					response = await getStreamsBitcoinEventsResponse({
						query: pollQuery,
						tip,
						readEvents: opts.readBitcoinEvents,
						readReorgs: readBitcoinReorgs,
					});
				} else {
					const tip = await getTip();
					if (!initialized) {
						// No start given → live-tail from the current (reorg-clamped) tip.
						const q = new URLSearchParams(filterParams);
						q.set("from_height", String(getClampedStreamsTipHeight(tip, tier)));
						pollQuery = q;
						initialized = true;
					}
					response = await getStreamsEventsResponse({
						query: pollQuery,
						tip,
						tier,
						readEvents: opts.readEvents,
						readReorgs,
					});
				}
				for (const event of response.events) {
					// Inline per-frame signature: SSE has no per-frame headers, so the
					// ed25519 proof rides in the frame body as `{ event, sig, key_id }`,
					// signed over the event's exact JSON bytes.
					const data = signer
						? JSON.stringify({
								event,
								sig: signer.sign(JSON.stringify(event)),
								key_id: signer.keyId,
							})
						: JSON.stringify({ event });
					await stream.writeSSE({ data, id: event.cursor });
				}
				if (response.events.length > 0) {
					if (accountId) {
						await debitStreamsCreditedRead(c, response.events);
					}
					lastBeat = Date.now();
					// Resume strictly after the last delivered cursor (input-exclusive).
					const next =
						response.next_cursor ?? response.events.at(-1)?.cursor ?? null;
					const q = new URLSearchParams(filterParams);
					if (next) q.set("from_cursor", next);
					pollQuery = q;
				} else if (Date.now() - lastBeat > STREAMS_SSE_HEARTBEAT_MS) {
					// Heartbeat as a custom `ping` event (SDK ignores it) to keep the
					// connection and any intermediary proxies alive while idle.
					await stream.writeSSE({ event: "ping", data: "" });
					lastBeat = Date.now();
				}
				await stream.sleep(STREAMS_SSE_POLL_MS);
			}
		});
	});

	router.get("/canonical/:height", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, STREAMS_CHAIN_ONLY_ALLOWED);
		const height = parseStreamsHeight(c.req.param("height"));
		if (resolveStreamsChain(query) === "bitcoin") {
			const readBlock =
				opts.readBitcoinCanonicalBlock ?? readStreamsBitcoinCanonicalBlock;
			const block = await readBlock(height);
			if (!block) {
				return c.json({ error: "Canonical block not found" }, 404);
			}
			const tip = await getBitcoinTip();
			const etag = `"${block.block_hash}"`;
			c.header("ETag", etag);
			c.header(
				"Cache-Control",
				streamsCacheControl(height <= tip.finalized_height),
			);
			if (matchesIfNoneMatch(c.req.header("If-None-Match"), etag)) {
				return c.body(null, 304);
			}
			return respondSignedJson(c, block);
		}
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
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, STREAMS_CHAIN_ONLY_ALLOWED);
		const txId = c.req.param("tx_id");
		if (!txId) return c.json({ error: "tx_id is required" }, 400);
		if (resolveStreamsChain(query) === "bitcoin") {
			const tip = await getBitcoinTip();
			const readEventsByTxId =
				opts.readBitcoinEventsByTxId ?? readStreamsBitcoinEventsByTxId;
			const result = await readEventsByTxId({ txId });
			if (result.events.length === 0) {
				return c.json({ error: "Transaction events not found" }, 404);
			}
			const firstEvent = result.events[0];
			const lastEvent = result.events.at(-1);
			const reorgs =
				firstEvent && lastEvent
					? await readBitcoinReorgs({
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
				streamsCacheControl(
					lastEvent !== undefined &&
						lastEvent.block_height <= tip.finalized_height,
				),
			);
			const accountId = c.get("streamsTenant")?.account_id;
			if (accountId) {
				await debitStreamsCreditedRead(c, result.events);
			}
			return respondSignedJson(c, {
				events: markBitcoinFinalized(result.events, tip.finalized_height),
				tip,
				reorgs,
			});
		}
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
		const accountId = c.get("streamsTenant")?.account_id;
		if (accountId) {
			await debitStreamsCreditedRead(c, result.events);
		}
		return respondSignedJson(c, {
			events: markFinalized(result.events, tip.finalized_height),
			tip,
			reorgs,
		});
	});

	router.get("/blocks/:heightOrHash/events", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, STREAMS_CHAIN_ONLY_ALLOWED);
		const heightOrHash = c.req.param("heightOrHash");
		const byHeight = /^(0|[1-9]\d*)$/.test(heightOrHash)
			? parseStreamsHeight(heightOrHash, "heightOrHash")
			: undefined;
		if (byHeight === undefined && heightOrHash.length === 0) {
			return c.json({ error: "heightOrHash is required" }, 400);
		}

		if (resolveStreamsChain(query) === "bitcoin") {
			const tip = await getBitcoinTip();
			const readBlockEvents =
				opts.readBitcoinBlockEvents ?? readStreamsBitcoinBlockEvents;
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
					? await readBitcoinReorgs({
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
				streamsCacheControl(
					firstEvent !== undefined &&
						firstEvent.block_height <= tip.finalized_height,
				),
			);
			const accountId = c.get("streamsTenant")?.account_id;
			if (accountId) {
				await debitStreamsCreditedRead(c, result.events);
			}
			return respondSignedJson(c, {
				events: markBitcoinFinalized(result.events, tip.finalized_height),
				tip,
				reorgs,
			});
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
		const accountId = c.get("streamsTenant")?.account_id;
		if (accountId) {
			await debitStreamsCreditedRead(c, result.events);
		}
		return respondSignedJson(c, {
			events: markFinalized(result.events, tip.finalized_height),
			tip,
			reorgs,
		});
	});

	router.get("/reorgs", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, STREAMS_REORGS_ALLOWED);
		if (resolveStreamsChain(query) === "bitcoin") {
			const since = query.get("since");
			if (!since) throw new ValidationError("since is required");
			const limitRaw = query.get("limit");
			const limit = limitRaw ? Number(limitRaw) : 100;
			if (!Number.isSafeInteger(limit) || limit < 1) {
				throw new ValidationError("limit must be a positive integer");
			}
			const readReorgsSince =
				opts.readBitcoinReorgsSince ?? readStreamsBitcoinReorgsSince;
			const reorgs = await readReorgsSince({
				since,
				limit: Math.min(1000, limit),
			});
			const last = reorgs.at(-1);
			return respondSignedJson(c, {
				reorgs,
				next_since: last ? encodeBitcoinReorgsNextSince(last) : null,
			});
		}
		const response = await getStreamsReorgsListResponse({
			query,
			readReorgsSince:
				opts.readReorgsSince ?? DEFAULT_STREAMS_REORGS_SINCE_READER,
		});
		return respondSignedJson(c, response);
	});

	router.get("/tip", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, STREAMS_CHAIN_ONLY_ALLOWED);
		c.header("Cache-Control", streamsCacheControl(false));
		if (resolveStreamsChain(query) === "bitcoin") {
			return respondSignedJson(c, await getBitcoinTip());
		}
		const tip = await getTip();
		// No retention floor: every account reads full history, so
		// there is no seekable floor to advertise anymore.
		return respondSignedJson(c, {
			...tip,
			oldest_seekable_height: null,
			oldest_cursor: null,
		});
	});

	return router;
}

export default createStreamsRouter({});
