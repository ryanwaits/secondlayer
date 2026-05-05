import { getDb } from "@secondlayer/shared/db";
import { incrementStreamsEventsReturned } from "@secondlayer/shared/db/queries/usage";
import { Hono } from "hono";
import {
	readCanonicalStreamsBlockEvents,
	readCanonicalStreamsEventsByTxId,
	type ReadStreamsBlockEventsParams,
	type ReadStreamsEventsByTxIdParams,
	type ReadStreamsEventsListResult,
} from "@secondlayer/indexer/streams-events";
import {
	DEFAULT_STREAMS_TOKEN_STORE,
	streamsBearerAuth,
	type StreamsEnv,
	type StreamsTokenStore,
} from "../streams/auth.ts";
import {
	parseStreamsHeight,
	readCanonicalStreamsBlock,
	type StreamsCanonicalBlockReader,
} from "../streams/canonical.ts";
import {
	getStreamsEventsResponse,
	type StreamsEventsReader,
} from "../streams/events.ts";
import { streamsRateLimit } from "../streams/rate-limit.ts";
import { streamsRetentionWindow } from "../streams/retention.ts";
import {
	DEFAULT_STREAMS_REORGS_READER,
	DEFAULT_STREAMS_REORGS_SINCE_READER,
	getStreamsReorgsListResponse,
	type StreamsReorgsReader,
	type StreamsReorgsSinceReader,
} from "../streams/reorgs.ts";
import { getStreamsTip, type StreamsTipProvider } from "../streams/tip.ts";

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
};

export function createStreamsRouter(opts: StreamsRouterOptions = {}) {
	const getTip = opts.getTip ?? getStreamsTip;
	const readReorgs = opts.readReorgs ?? DEFAULT_STREAMS_REORGS_READER;
	const recordEventsReturned =
		opts.recordEventsReturned ??
		((accountId, quantity) =>
			incrementStreamsEventsReturned(getDb(), accountId, quantity));
	const router = new Hono<StreamsEnv>();

	router.use(
		"*",
		streamsBearerAuth({ tokens: opts.tokens ?? DEFAULT_STREAMS_TOKEN_STORE }),
	);
	router.use("*", streamsRateLimit());
	router.use("/events", streamsRetentionWindow({ getTip }));

	router.get("/events", async (c) => {
		const tip = c.get("streamsTip");
		const response = await getStreamsEventsResponse({
			query: new URL(c.req.url).searchParams,
			tip,
			readEvents: opts.readEvents,
			readReorgs,
		});
		const accountId = c.get("streamsTenant").account_id;
		if (accountId && response.events.length > 0) {
			await recordEventsReturned(accountId, response.events.length);
		}
		return c.json(response);
	});

	router.get("/canonical/:height", async (c) => {
		const height = parseStreamsHeight(c.req.param("height"));
		const readCanonicalBlock =
			opts.readCanonicalBlock ?? readCanonicalStreamsBlock;
		const block = await readCanonicalBlock(height);
		if (!block) {
			return c.json({ error: "Canonical block not found" }, 404);
		}
		c.header("ETag", `"${block.index_block_hash}"`);
		return c.json(block);
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
		return c.json({ events: result.events, tip, reorgs });
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
				? { indexBlockHash: heightOrHash }
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
		return c.json({ events: result.events, tip, reorgs });
	});

	router.get("/reorgs", async (c) => {
		const response = await getStreamsReorgsListResponse({
			query: new URL(c.req.url).searchParams,
			readReorgsSince:
				opts.readReorgsSince ?? DEFAULT_STREAMS_REORGS_SINCE_READER,
		});
		return c.json(response);
	});

	router.get("/tip", async (c) => c.json(await getTip()));

	return router;
}

export default createStreamsRouter();
