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
import {
	type BurnchainRewardSlotsReader,
	type BurnchainRewardsReader,
	getBurnchainRewardSlotsResponse,
	getBurnchainRewardsResponse,
} from "../datasets/burnchain/query.ts";
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
import { validateQueryParams } from "../middleware/validation.ts";
import { getStreamsTip } from "../streams/tip.ts";

const RANGE_KEYS = ["limit", "cursor", "from_block", "to_block"] as const;

const DUCKDB_EXAMPLE = {
	via_manifest: [
		"-- via manifest (recommended; no LIST permission needed)",
		"WITH m AS (SELECT * FROM read_json_auto('<r2-root>/<family>/latest.json'))",
		"SELECT topic, count(*) FROM read_parquet(m.files) GROUP BY topic;",
	].join("\n"),
	via_glob: [
		"-- via glob (requires LIST + http_asterisks setting)",
		"SET allow_asterisks_in_http_paths = true;",
		"SELECT topic, count(*) FROM read_parquet(",
		"  '<r2-root>/<family>/data/block_height/*/data.parquet'",
		") GROUP BY topic;",
	].join("\n"),
};

const DATASETS_DISCOVERY = [
	{
		family: "stx-transfers",
		path: "/v1/datasets/stx-transfers",
		row_key: "events",
		filters: [
			"limit",
			"cursor",
			"from_block",
			"to_block",
			"sender",
			"recipient",
		],
	},
	{
		family: "sbtc-events",
		path: "/v1/datasets/sbtc/events",
		row_key: "events",
		filters: [
			"limit",
			"cursor",
			"from_block",
			"to_block",
			"topic",
			"bitcoin_txid",
			"request_id",
			"sender",
		],
	},
	{
		family: "sbtc-token-events",
		path: "/v1/datasets/sbtc/token-events",
		row_key: "events",
		filters: [
			"limit",
			"cursor",
			"from_block",
			"to_block",
			"event_type",
			"sender",
			"recipient",
		],
	},
	{
		family: "pox-4-calls",
		path: "/v1/datasets/pox-4/calls",
		row_key: "calls",
		filters: [
			"limit",
			"cursor",
			"from_block",
			"to_block",
			"function_name",
			"stacker",
			"delegate_to",
			"signer_key",
			"reward_cycle",
			"address",
		],
	},
	{
		family: "burnchain-rewards",
		path: "/v1/datasets/burnchain/rewards",
		row_key: "rewards",
		filters: ["limit", "cursor", "from_block", "to_block", "recipient"],
	},
	{
		family: "burnchain-reward-slots",
		path: "/v1/datasets/burnchain/reward-slots",
		row_key: "slots",
		filters: ["limit", "cursor", "from_block", "to_block", "holder"],
	},
	{
		family: "bns-events",
		path: "/v1/datasets/bns/events",
		row_key: "events",
		filters: [
			"limit",
			"cursor",
			"from_block",
			"to_block",
			"topic",
			"namespace",
			"name",
			"owner",
		],
	},
	{
		family: "bns-namespace-events",
		path: "/v1/datasets/bns/namespace-events",
		row_key: "events",
		filters: [
			"limit",
			"cursor",
			"from_block",
			"to_block",
			"status",
			"namespace",
		],
	},
	{
		family: "bns-marketplace-events",
		path: "/v1/datasets/bns/marketplace-events",
		row_key: "events",
		filters: ["limit", "cursor", "from_block", "to_block", "action", "bns_id"],
	},
	{
		family: "bns-names",
		path: "/v1/datasets/bns/names",
		row_key: "names",
		filters: ["limit", "cursor", "namespace", "owner", "offset"],
	},
	{
		family: "bns-namespaces",
		path: "/v1/datasets/bns/namespaces",
		row_key: "namespaces",
		filters: [],
	},
	{
		family: "bns-resolve",
		path: "/v1/datasets/bns/resolve",
		row_key: "name",
		filters: ["fqn"],
	},
	{
		family: "network-health",
		path: "/v1/datasets/network-health/summary",
		row_key: "summary",
		filters: ["days"],
	},
] as const;

const ALLOWED = {
	networkHealth: ["days"],
	stxTransfers: [...RANGE_KEYS, "sender", "recipient"],
	sbtcEvents: [...RANGE_KEYS, "topic", "bitcoin_txid", "request_id", "sender"],
	sbtcTokenEvents: [...RANGE_KEYS, "event_type", "sender", "recipient"],
	pox4Calls: [
		...RANGE_KEYS,
		"function_name",
		"stacker",
		"delegate_to",
		"signer_key",
		"reward_cycle",
		"address",
	],
	burnchainRewards: [...RANGE_KEYS, "recipient"],
	burnchainRewardSlots: [...RANGE_KEYS, "holder"],
	bnsNameEvents: [...RANGE_KEYS, "topic", "namespace", "name", "owner"],
	bnsNamespaceEvents: [...RANGE_KEYS, "status", "namespace"],
	bnsMarketplaceEvents: [...RANGE_KEYS, "action", "bns_id"],
	bnsNames: ["limit", "cursor", "namespace", "owner", "offset"],
	bnsNamespaces: [] as string[],
	bnsResolve: ["fqn"],
} as const;

const DATASETS_IP_RATE_LIMIT = Number.parseInt(
	process.env.DATASETS_IP_RATE_LIMIT ?? "60",
	10,
);

export type DatasetsRouterOptions = {
	getTip?: () => Promise<{
		block_height: number;
		burn_block_height?: number;
	} | null>;
	readStxTransfers?: StxTransfersReader;
	readSbtcEvents?: SbtcEventsReader;
	readSbtcTokenEvents?: SbtcTokenEventsReader;
	readPox4Calls?: Pox4CallsReader;
	readBurnchainRewards?: BurnchainRewardsReader;
	readBurnchainRewardSlots?: BurnchainRewardSlotsReader;
};

export function createDatasetsRouter(opts: DatasetsRouterOptions = {}) {
	const router = new Hono();
	const getTip = opts.getTip ?? getStreamsTip;

	router.use("*", ipRateLimit(DATASETS_IP_RATE_LIMIT));

	router.get("/", (c) =>
		c.json({
			families: DATASETS_DISCOVERY,
			cursor_format: "<block_height>:<event_index>",
			example_duckdb: DUCKDB_EXAMPLE,
		}),
	);

	router.get("/network-health/summary", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, ALLOWED.networkHealth);
		const tip = await getTip();
		const response = await getNetworkHealthResponse({
			query,
			tip: tip ? { block_height: tip.block_height } : null,
		});
		return c.json(response);
	});

	router.get("/stx-transfers", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, ALLOWED.stxTransfers);
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
			query,
			tip: { block_height: tip.block_height },
			readTransfers: opts.readStxTransfers,
		});
		return c.json(response);
	});

	router.get("/sbtc/events", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, ALLOWED.sbtcEvents);
		const tip = await getTip();
		if (!tip) {
			return c.json({ events: [], next_cursor: null, tip: null }, 503);
		}
		const response = await getSbtcEventsResponse({
			query,
			tip: { block_height: tip.block_height },
			readEvents: opts.readSbtcEvents,
		});
		return c.json(response);
	});

	router.get("/sbtc/token-events", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, ALLOWED.sbtcTokenEvents);
		const tip = await getTip();
		if (!tip) {
			return c.json({ events: [], next_cursor: null, tip: null }, 503);
		}
		const response = await getSbtcTokenEventsResponse({
			query,
			tip: { block_height: tip.block_height },
			readEvents: opts.readSbtcTokenEvents,
		});
		return c.json(response);
	});

	router.get("/pox-4/calls", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, ALLOWED.pox4Calls);
		const tip = await getTip();
		if (!tip) {
			return c.json({ calls: [], next_cursor: null, tip: null }, 503);
		}
		const response = await getPox4CallsResponse({
			query,
			tip: { block_height: tip.block_height },
			readCalls: opts.readPox4Calls,
		});
		return c.json(response);
	});

	router.get("/burnchain/rewards", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, ALLOWED.burnchainRewards);
		const tip = await getTip();
		if (!tip || tip.burn_block_height === undefined) {
			return c.json({ rewards: [], next_cursor: null, tip: null }, 503);
		}
		const response = await getBurnchainRewardsResponse({
			query,
			tip: { burn_block_height: tip.burn_block_height },
			readRewards: opts.readBurnchainRewards,
		});
		return c.json(response);
	});

	router.get("/burnchain/reward-slots", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, ALLOWED.burnchainRewardSlots);
		const tip = await getTip();
		if (!tip || tip.burn_block_height === undefined) {
			return c.json({ slots: [], next_cursor: null, tip: null }, 503);
		}
		const response = await getBurnchainRewardSlotsResponse({
			query,
			tip: { burn_block_height: tip.burn_block_height },
			readSlots: opts.readBurnchainRewardSlots,
		});
		return c.json(response);
	});

	router.get("/bns/events", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, ALLOWED.bnsNameEvents);
		const tip = await getTip();
		if (!tip) {
			return c.json({ events: [], next_cursor: null, tip: null }, 503);
		}
		const response = await getBnsNameEventsResponse({
			query,
			tip: { block_height: tip.block_height },
		});
		return c.json(response);
	});

	router.get("/bns/namespace-events", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, ALLOWED.bnsNamespaceEvents);
		const tip = await getTip();
		if (!tip) {
			return c.json({ events: [], next_cursor: null, tip: null }, 503);
		}
		const response = await getBnsNamespaceEventsResponse({
			query,
			tip: { block_height: tip.block_height },
		});
		return c.json(response);
	});

	router.get("/bns/marketplace-events", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, ALLOWED.bnsMarketplaceEvents);
		const tip = await getTip();
		if (!tip) {
			return c.json({ events: [], next_cursor: null, tip: null }, 503);
		}
		const response = await getBnsMarketplaceEventsResponse({
			query,
			tip: { block_height: tip.block_height },
		});
		return c.json(response);
	});

	router.get("/bns/names", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, ALLOWED.bnsNames);
		const tip = await getTip();
		const response = await getBnsNamesResponse({ query });
		return c.json({
			...response,
			tip: tip ? { block_height: tip.block_height } : null,
		});
	});

	router.get("/bns/namespaces", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, ALLOWED.bnsNamespaces);
		const response = await getBnsNamespacesResponse();
		return c.json(response);
	});

	router.get("/bns/resolve", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, ALLOWED.bnsResolve);
		const result = await getBnsResolveResponse({ query });
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
