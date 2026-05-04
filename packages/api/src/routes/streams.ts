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
};

export function createStreamsRouter(opts: StreamsRouterOptions = {}) {
	const getTip = opts.getTip ?? getStreamsTip;
	const router = new Hono<StreamsEnv>();

	router.use(
		"*",
		streamsBearerAuth({ tokens: opts.tokens ?? DEFAULT_STREAMS_TOKEN_STORE }),
	);
	router.use("*", streamsRateLimit());
	router.use("/events", streamsRetentionWindow({ getTip }));

	router.get("/events", async (c) => {
		const tip = c.get("streamsTip");
		return c.json(
			await getStreamsEventsResponse({
				query: new URL(c.req.url).searchParams,
				tip,
				readEvents: opts.readEvents,
			}),
		);
	});

	router.get("/tip", async (c) => c.json(await getTip()));

	return router;
}

export default createStreamsRouter();
