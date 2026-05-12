import { Hono } from "hono";
import { ipRateLimit } from "../auth/index.ts";
import {
	getBnsMarketplaceEventsResponse,
	getBnsNameEventsResponse,
	getBnsNamesResponse,
	getBnsNamespaceEventsResponse,
	getBnsNamespacesResponse,
	getBnsResolveResponse,
} from "../datasets/bns/query.ts";
import { getNetworkHealthResponse } from "../datasets/network-health/query.ts";
import {
	type Pox4CallsReader,
	getPox4CallsResponse,
} from "../datasets/pox-4/query.ts";
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
	readPox4Calls?: Pox4CallsReader;
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
			return c.json({ events: [], next_cursor: null, tip: null }, 503);
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
			return c.json({ events: [], next_cursor: null, tip: null }, 503);
		}
		const response = await getSbtcTokenEventsResponse({
			query: new URL(c.req.url).searchParams,
			tip: { block_height: tip.block_height },
			readEvents: opts.readSbtcTokenEvents,
		});
		return c.json(response);
	});

	router.get("/pox-4/calls", async (c) => {
		const tip = await getTip();
		if (!tip) {
			return c.json({ calls: [], next_cursor: null, tip: null }, 503);
		}
		const response = await getPox4CallsResponse({
			query: new URL(c.req.url).searchParams,
			tip: { block_height: tip.block_height },
			readCalls: opts.readPox4Calls,
		});
		return c.json(response);
	});

	router.get("/bns/name-events", async (c) => {
		const tip = await getTip();
		if (!tip) {
			return c.json({ events: [], next_cursor: null, tip: null }, 503);
		}
		const response = await getBnsNameEventsResponse({
			query: new URL(c.req.url).searchParams,
			tip: { block_height: tip.block_height },
		});
		return c.json(response);
	});

	router.get("/bns/namespace-events", async (c) => {
		const tip = await getTip();
		if (!tip) {
			return c.json({ events: [], next_cursor: null, tip: null }, 503);
		}
		const response = await getBnsNamespaceEventsResponse({
			query: new URL(c.req.url).searchParams,
			tip: { block_height: tip.block_height },
		});
		return c.json(response);
	});

	router.get("/bns/marketplace-events", async (c) => {
		const tip = await getTip();
		if (!tip) {
			return c.json({ events: [], next_cursor: null, tip: null }, 503);
		}
		const response = await getBnsMarketplaceEventsResponse({
			query: new URL(c.req.url).searchParams,
			tip: { block_height: tip.block_height },
		});
		return c.json(response);
	});

	router.get("/bns/names", async (c) => {
		const response = await getBnsNamesResponse({
			query: new URL(c.req.url).searchParams,
		});
		return c.json(response);
	});

	router.get("/bns/namespaces", async (c) => {
		const response = await getBnsNamespacesResponse();
		return c.json(response);
	});

	router.get("/bns/resolve", async (c) => {
		const result = await getBnsResolveResponse({
			query: new URL(c.req.url).searchParams,
		});
		if (result.status === "found") return c.json(result.name);
		if (result.status === "not_indexed") {
			return c.json(
				{
					error: "not_indexed",
					code: "BACKFILL_PENDING",
					reason: `Name not in indexed range (currently block ${result.earliest_indexed_block}+). If registered earlier, history is being reprocessed.`,
					earliest_indexed_block: result.earliest_indexed_block,
				},
				503,
			);
		}
		return c.json({ error: "not found", code: "NOT_FOUND" }, 404);
	});

	return router;
}

export default createDatasetsRouter();
