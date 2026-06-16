import type { PlaygroundConfig } from "./types";

const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

/**
 * Real, keyless configs. Endpoints are public GET reads — no key, no login.
 * Each is a complete spec; the marketing surface just drops <Playground
 * config={…}> into the inline dock.
 */

/** Streams — tail the live firehose over SSE. Read product → API-key payoff. */
export const streamsTail: PlaygroundConfig = {
	id: "streams-tail",
	product: "streams",
	request: {
		path: "/v1/streams/events/stream",
		mode: "sse",
		fields: [
			{
				kind: "enum",
				name: "event_type",
				label: "event type",
				into: "query",
				default: "",
				options: [
					{ value: "", label: "all events" },
					{ value: "ft_transfer", label: "ft_transfer" },
					{ value: "nft_transfer", label: "nft_transfer" },
					{ value: "stx_transfer", label: "stx_transfer" },
					{ value: "contract_call", label: "contract_call" },
				],
			},
		],
	},
	render: "ticker",
	payoff: {
		kind: "apiKey",
		blurb:
			"Keyless reads are rate-limited. A key lifts limits and works in your code.",
	},
};

/** Index — query decoded rows. Read product → API-key payoff. */
export const indexQuery: PlaygroundConfig = {
	id: "index-events",
	product: "index",
	request: {
		path: "/v1/index/events",
		mode: "rest",
		fields: [
			{
				kind: "enum",
				name: "event_type",
				label: "event type",
				into: "query",
				default: "ft_transfer",
				options: [
					{ value: "ft_transfer", label: "ft_transfer" },
					{ value: "nft_transfer", label: "nft_transfer" },
					{ value: "stx_transfer", label: "stx_transfer" },
					{ value: "contract_call", label: "contract_call" },
				],
			},
			{
				kind: "contract",
				name: "contract_id",
				label: "contract",
				into: "query",
				default: SBTC_TOKEN,
				placeholder: "SP….contract-name",
			},
			{
				kind: "number",
				name: "limit",
				label: "limit",
				into: "query",
				default: 5,
				min: 1,
				max: 50,
			},
		],
	},
	render: "json",
	presets: [
		{
			label: "sBTC transfers",
			values: { event_type: "ft_transfer", contract_id: SBTC_TOKEN },
		},
		{
			label: "STX transfers",
			values: { event_type: "stx_transfer", contract_id: "" },
		},
		{
			label: "NFT transfers",
			values: { event_type: "nft_transfer", contract_id: "" },
		},
		{
			label: "Contract calls",
			values: { event_type: "contract_call", contract_id: "" },
		},
	],
	agents: {
		markdown: "/v1/index/events/docs.md",
		openapi: "/v1/index/openapi.json",
	},
	payoff: {
		kind: "apiKey",
		blurb:
			"Keyless reads are rate-limited. A key lifts limits and works in your code.",
	},
};

/** Subgraphs — query a live one. Resource → claim/fork payoff. */
export const subgraphFork: PlaygroundConfig = {
	id: "subgraph-fork",
	product: "subgraphs",
	request: {
		path: "/v1/subgraphs/{name}/{table}",
		mode: "rest",
		fields: [
			{
				kind: "text",
				name: "name",
				label: "subgraph",
				into: "path",
				default: "sbtc-flows",
			},
			{
				kind: "text",
				name: "table",
				label: "table",
				into: "path",
				default: "transfers",
			},
			{
				kind: "enum",
				name: "_order",
				label: "order",
				into: "query",
				default: "desc",
				options: [{ value: "desc" }, { value: "asc" }],
			},
			{
				kind: "number",
				name: "_limit",
				label: "limit",
				into: "query",
				default: 5,
				min: 1,
				max: 50,
			},
		],
	},
	render: "json",
	agents: {
		markdown: "/v1/subgraphs/sbtc-flows/docs.md",
		openapi: "/v1/subgraphs/sbtc-flows/openapi.json",
		schema: "/v1/subgraphs/sbtc-flows/schema.json",
		stream: "/v1/subgraphs/sbtc-flows/transfers/stream",
	},
	payoff: {
		kind: "claim",
		resource: "subgraph",
		cta: "Fork into your account",
		success:
			"Account created · subgraphs/sbtc-flows is deployed under your name, backfilling now.",
		scaffold: "sl subgraphs scaffold sbtc-flows -o my-sbtc-flows.ts",
	},
};

export const PLAYGROUND_CONFIGS = {
	[streamsTail.id]: streamsTail,
	[indexQuery.id]: indexQuery,
	[subgraphFork.id]: subgraphFork,
} as const;
