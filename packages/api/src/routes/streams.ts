import { getDb } from "@secondlayer/shared/db";
import { incrementStreamsEventsReturned } from "@secondlayer/shared/db/queries/usage";
import { Hono } from "hono";
import {
	DEFAULT_STREAMS_TOKEN_STORE,
	streamsBearerAuth,
	type StreamsEnv,
	type StreamsTokenStore,
} from "../streams/auth.ts";
import {
	getStreamsEventsResponse,
	type StreamsEventsReader,
} from "../streams/events.ts";
import { streamsRateLimit } from "../streams/rate-limit.ts";
import { streamsRetentionWindow } from "../streams/retention.ts";
import { getStreamsTip, type StreamsTipProvider } from "../streams/tip.ts";

export type StreamsRouterOptions = {
	tokens?: StreamsTokenStore;
	getTip?: StreamsTipProvider;
	readEvents?: StreamsEventsReader;
	recordEventsReturned?: (accountId: string, quantity: number) => Promise<void>;
};

export function createStreamsRouter(opts: StreamsRouterOptions = {}) {
	const getTip = opts.getTip ?? getStreamsTip;
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
		});
		const accountId = c.get("streamsTenant").account_id;
		if (accountId && response.events.length > 0) {
			await recordEventsReturned(accountId, response.events.length);
		}
		return c.json(response);
	});

	router.get("/tip", async (c) => c.json(await getTip()));

	return router;
}

export default createStreamsRouter();
