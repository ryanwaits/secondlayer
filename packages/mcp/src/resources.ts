import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "./lib/client.ts";
import { formatSubgraphSummary } from "./lib/format.ts";
import { getRegisteredToolNames } from "./lib/tool.ts";

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

// One-line human blurb per product surface; the tool list for each is
// generated from the live tool registry (see buildCapabilities) so it can't
// drift behind the actual surface.
const PRODUCT_BLURBS: Record<string, string> = {
	datasets: "public foundation datasets",
	index:
		"decoded L2 events, contract calls, blocks, transactions, stacking, mempool",
	streams: "raw canonical chain event firehose",
	contracts: "trait-based contract discovery",
	subgraphs: "author/deploy/query custom indexes",
	subscriptions: "webhook delivery on subgraph rows or raw chain events",
	account: "identity, plan, billing, and API keys",
	scaffold: "generate typed contract clients from a deployment or ABI",
};

const PRODUCT_ORDER = [
	"datasets",
	"index",
	"streams",
	"contracts",
	"subgraphs",
	"subscriptions",
	"account",
	"scaffold",
];

/**
 * "What you can do" overview, generated from the registered tool names so every
 * tool surfaces under its product without a hand-maintained list to fall stale.
 * Tools register (via defineTool) before registerResources runs, so the
 * registry is fully populated by the time a context read calls this.
 */
export function buildCapabilities() {
	const byPrefix = new Map<string, string[]>();
	for (const name of getRegisteredToolNames()) {
		const prefix = name.slice(0, name.indexOf("_"));
		const tools = byPrefix.get(prefix) ?? [];
		tools.push(name);
		byPrefix.set(prefix, tools);
	}
	const order = [
		...PRODUCT_ORDER.filter((p) => byPrefix.has(p)),
		...[...byPrefix.keys()].filter((p) => !PRODUCT_ORDER.includes(p)),
	];
	const products = order.map((p) => {
		const tools = byPrefix.get(p) ?? [];
		const blurb = PRODUCT_BLURBS[p];
		return blurb
			? `${p} — ${blurb} (${tools.join(", ")})`
			: `${p} (${tools.join(", ")})`;
	});
	return {
		products,
		discoverFirst:
			"Call datasets_list / contracts_find to learn what exists before querying.",
	};
}

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
};

/**
 * Assemble the live agent context read at connect: who you are, the live
 * Streams/Index tips, what you own (subgraphs/subscriptions), any in-flight
 * reindex operations, what the agent can do, and the read-auth tiers. The
 * snapshot comes from the SDK's `context()` (shared with non-MCP agents); each
 * field that couldn't be read becomes a sentinel string so the resource never
 * throws and always orients the agent.
 */
export async function buildContext(
	deps: ContextDeps = { clientProvider: getClient },
) {
	const unavailable = "unavailable: set SL_API_KEY";
	const orNull = <T>(v: T | null | undefined) => (v == null ? unavailable : v);

	const snap = await deps
		.clientProvider()
		.context()
		.catch(() => null);

	return {
		authState: { apiKeySet: Boolean(process.env.SL_API_KEY) },
		whatExists: {
			account: orNull(snap?.account),
			streamsTip: orNull(snap?.streamsTip),
			indexTip: orNull(snap?.indexTip),
			subgraphs: snap?.subgraphs
				? snap.subgraphs.map(formatSubgraphSummary)
				: unavailable,
			subscriptions: orNull(snap?.subscriptions),
			activeOperations: orNull(snap?.activeOperations),
		},
		whatYouCanDo: buildCapabilities(),
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
