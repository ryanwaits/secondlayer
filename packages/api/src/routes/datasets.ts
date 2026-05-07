import { Hono } from "hono";
import { ipRateLimit } from "../auth/index.ts";
import { getNetworkHealthResponse } from "../datasets/network-health/query.ts";
import {
	type SbtcEventsReader,
	type SbtcTokenEventsReader,
	getSbtcEventsResponse,
	getSbtcTokenEventsResponse,
} from "../datasets/sbtc/query.ts";
import {
	type StxTransfersReader,
	getStxTransfersResponse,
} from "../datasets/stx-transfers/query.ts";
import { getStreamsTip } from "../streams/tip.ts";

const DATASETS_IP_RATE_LIMIT = Number.parseInt(
	process.env.DATASETS_IP_RATE_LIMIT ?? "60",
	10,
);

export type DatasetsRouterOptions = {
	getTip?: () => Promise<{ block_height: number } | null>;
	readStxTransfers?: StxTransfersReader;
	readSbtcEvents?: SbtcEventsReader;
	readSbtcTokenEvents?: SbtcTokenEventsReader;
};

export function createDatasetsRouter(opts: DatasetsRouterOptions = {}) {
	const router = new Hono();
	const getTip = opts.getTip ?? getStreamsTip;

	router.use("*", ipRateLimit(DATASETS_IP_RATE_LIMIT));

	router.get("/network-health/summary", async (c) => {
		const tip = await getTip();
		const response = await getNetworkHealthResponse({
			query: new URL(c.req.url).searchParams,
			tip: tip ? { block_height: tip.block_height } : null,
		});
		return c.json(response);
	});

	router.get("/stx-transfers", async (c) => {
		const tip = await getTip();
		if (!tip) {
			return c.json(
				{
					events: [],
					next_cursor: null,
					tip: null,
				},
				503,
			);
		}
		const response = await getStxTransfersResponse({
			query: new URL(c.req.url).searchParams,
			tip: { block_height: tip.block_height },
			readTransfers: opts.readStxTransfers,
		});
		return c.json(response);
	});

	router.get("/sbtc/events", async (c) => {
		const tip = await getTip();
		if (!tip) {
			return c.json(
				{ events: [], next_cursor: null, tip: null },
				503,
			);
		}
		const response = await getSbtcEventsResponse({
			query: new URL(c.req.url).searchParams,
			tip: { block_height: tip.block_height },
			readEvents: opts.readSbtcEvents,
		});
		return c.json(response);
	});

	router.get("/sbtc/token-events", async (c) => {
		const tip = await getTip();
		if (!tip) {
			return c.json(
				{ events: [], next_cursor: null, tip: null },
				503,
			);
		}
		const response = await getSbtcTokenEventsResponse({
			query: new URL(c.req.url).searchParams,
			tip: { block_height: tip.block_height },
			readEvents: opts.readSbtcTokenEvents,
		});
		return c.json(response);
	});

	return router;
}

export default createDatasetsRouter();
