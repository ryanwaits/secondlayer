import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest, getClient } from "./lib/client.ts";
import { formatSubgraphSummary } from "./lib/format.ts";

/** Filter types for blockchain events — SubgraphFilter vocabulary. */
const FILTERS_REFERENCE = [
	{
		type: "stx_transfer",
		fields: ["sender", "recipient", "minAmount", "maxAmount"],
	},
	{ type: "stx_mint", fields: ["recipient", "minAmount"] },
	{ type: "stx_burn", fields: ["sender", "minAmount"] },
	{ type: "stx_lock", fields: ["lockedAddress", "minAmount"] },
	{
		type: "ft_transfer",
		fields: [
			"sender",
			"recipient",
			"assetIdentifier",
			"minAmount",
			"maxAmount",
		],
	},
	{ type: "ft_mint", fields: ["recipient", "assetIdentifier", "minAmount"] },
	{ type: "ft_burn", fields: ["sender", "assetIdentifier", "minAmount"] },
	{
		type: "nft_transfer",
		fields: ["sender", "recipient", "assetIdentifier", "tokenId"],
	},
	{ type: "nft_mint", fields: ["recipient", "assetIdentifier", "tokenId"] },
	{ type: "nft_burn", fields: ["sender", "assetIdentifier", "tokenId"] },
	{ type: "contract_call", fields: ["contract", "function"] },
	{ type: "contract_deploy", fields: ["contract"] },
	{ type: "print_event", fields: ["contract", "event", "contains"] },
];

const COLUMN_TYPES = [
	{
		type: "uint",
		sqlType: "bigint",
		description: "Unsigned integer (Clarity uint)",
	},
	{
		type: "int",
		sqlType: "bigint",
		description: "Signed integer (Clarity int)",
	},
	{ type: "text", sqlType: "text", description: "UTF-8 string" },
	{
		type: "principal",
		sqlType: "text",
		description: "Stacks address (standard or contract)",
	},
	{ type: "bool", sqlType: "boolean", description: "Boolean value" },
	{ type: "json", sqlType: "jsonb", description: "Arbitrary JSON data" },
	{
		options: ["nullable", "indexed", "search"],
		description:
			"Column options: nullable allows NULL, indexed creates a B-tree index, search enables full-text search",
	},
];

/** Static "what you can do" overview — the product surfaces an agent can reach. */
const CAPABILITIES = {
	products: [
		"datasets — public foundation datasets (datasets_list, datasets_query)",
		"index — decoded L2 events + contract calls (index_ft_transfers, index_nft_transfers, index_events, index_contract_calls)",
		"streams — raw chain event firehose (streams_tip, streams_events)",
		"contracts — trait-based contract discovery (contracts_find)",
		"subgraphs — author/deploy/query custom indexes (subgraphs_deploy, subgraphs_query, subgraphs_list, subgraphs_get, subgraphs_reindex, subgraphs_delete)",
		"subscriptions — webhook delivery of subgraph rows (subscriptions_create, subscriptions_list, subscriptions_update, …)",
		"account — identity + plan (account_whoami)",
	],
	discoverFirst:
		"Call datasets_list / contracts_find to learn what exists before querying.",
};

/** Per-product read-auth tiers — what an agent must know before reading. */
const READ_AUTH_TIERS = {
	datasets: "open — no API key required",
	index:
		"anonymous reads allowed; free-tier API keys are rejected (Build+ required)",
	streams: "API key required (SL_API_KEY) — keyless calls return 401",
	subgraphs: "reads public during open beta; writes require an API key",
};

type ContextDeps = {
	clientProvider: typeof getClient;
	accountRequest: () => Promise<{ email: string; plan: string }>;
};

/**
 * Assemble the live agent context read at connect: what exists (the user's
 * subgraphs/subscriptions + account), what the agent can do, and the read-auth
 * tiers. Every live call degrades to a sentinel string on failure (e.g. keyless
 * requests that 401) so the resource never throws and always orients the agent.
 */
export async function buildContext(
	deps: ContextDeps = {
		clientProvider: getClient,
		accountRequest: () =>
			apiRequest<{ email: string; plan: string }>("GET", "/api/accounts/me"),
	},
) {
	const unavailable = "unavailable: set SL_API_KEY";

	const subgraphs = await deps
		.clientProvider()
		.subgraphs.list()
		.then((r) => r.data.map(formatSubgraphSummary))
		.catch(() => unavailable);

	const subscriptions = await deps
		.clientProvider()
		.subscriptions.list()
		.then((r) => ({
			count: r.data.length,
			statuses: r.data.map((s: { status: string }) => s.status),
		}))
		.catch(() => unavailable);

	const account = await deps.accountRequest().catch(() => unavailable);

	return {
		authState: { apiKeySet: Boolean(process.env.SL_API_KEY) },
		whatExists: { subgraphs, subscriptions, account },
		whatYouCanDo: CAPABILITIES,
		readAuthTiers: READ_AUTH_TIERS,
	};
}

export function registerResources(server: McpServer) {
	server.resource(
		"context",
		"secondlayer://context",
		{
			description:
				"Live agent context — what exists (your subgraphs, subscriptions, account), what you can do, and read-auth tiers. Read this first.",
		},
		async () => ({
			contents: [
				{
					uri: "secondlayer://context",
					mimeType: "application/json",
					text: JSON.stringify(await buildContext(), null, 2),
				},
			],
		}),
	);

	server.resource(
		"filters",
		"secondlayer://filters",
		{ description: "Event filter types and their available fields" },
		async () => ({
			contents: [
				{
					uri: "secondlayer://filters",
					mimeType: "application/json",
					text: JSON.stringify(FILTERS_REFERENCE, null, 2),
				},
			],
		}),
	);

	server.resource(
		"column-types",
		"secondlayer://column-types",
		{ description: "Subgraph column types, SQL mappings, and options" },
		async () => ({
			contents: [
				{
					uri: "secondlayer://column-types",
					mimeType: "application/json",
					text: JSON.stringify(COLUMN_TYPES, null, 2),
				},
			],
		}),
	);
}
