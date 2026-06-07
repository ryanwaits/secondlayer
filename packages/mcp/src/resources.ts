import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CHAIN_TRIGGER_FIELDS, DECODED_EVENT_TYPES } from "@secondlayer/shared";
import { TRAIT_STANDARDS } from "@secondlayer/stacks/clarity";
import { TYPE_MAP } from "@secondlayer/subgraphs/schema";
import type { ColumnType } from "@secondlayer/subgraphs/types";
import { getClient } from "./lib/client.ts";
import { formatSubgraphSummary } from "./lib/format.ts";
import { getRegisteredToolNames } from "./lib/tool.ts";

// SubgraphFilter vocabulary — the per-type fields an agent may set on a source
// filter. Fields are hand-authored (the per-type breakdown lives only in the
// SubgraphFilter interfaces), but the drift test in resources.test.ts locks the
// type set to VALID_FILTER_TYPES and asserts every field is accepted by the
// `.strict()` SubgraphFilterSchema, so this can never advertise a field the
// validator rejects. `trait` (TraitScope) indexes all contracts of a standard
// (e.g. all SIP-010 tokens). `prints` on print_event is type-level only (not a
// runtime match field) and is intentionally omitted.
// One-line human blurb per SIP trait standard, keyed by TRAIT_STANDARDS so a new
// standard forces an entry here.
const TRAIT_BLURBS: Record<(typeof TRAIT_STANDARDS)[number], string> = {
	"sip-009": "Non-fungible token (NFT) standard",
	"sip-010": "Fungible token standard",
	"sip-013": "Semi-fungible token standard",
};

export const FILTERS_REFERENCE = [
	{
		type: "stx_transfer",
		fields: ["sender", "recipient", "minAmount", "maxAmount"],
	},
	{ type: "stx_mint", fields: ["recipient", "minAmount"] },
	{ type: "stx_burn", fields: ["sender", "minAmount"] },
	{ type: "stx_lock", fields: ["lockedAddress", "minAmount"] },
	{
		type: "ft_transfer",
		fields: ["sender", "recipient", "assetIdentifier", "minAmount", "trait"],
	},
	{
		type: "ft_mint",
		fields: ["recipient", "assetIdentifier", "minAmount", "trait"],
	},
	{
		type: "ft_burn",
		fields: ["sender", "assetIdentifier", "minAmount", "trait"],
	},
	{
		type: "nft_transfer",
		fields: ["sender", "recipient", "assetIdentifier", "trait"],
	},
	{ type: "nft_mint", fields: ["recipient", "assetIdentifier", "trait"] },
	{ type: "nft_burn", fields: ["sender", "assetIdentifier", "trait"] },
	{
		type: "contract_call",
		fields: ["contractId", "functionName", "caller", "trait", "abi"],
	},
	{ type: "contract_deploy", fields: ["deployer", "contractName"] },
	{ type: "print_event", fields: ["contractId", "topic", "trait"] },
];

// Human blurb per column type, keyed by ColumnType so adding a type to the union
// forces an entry here (the drift test in resources.test.ts asserts full coverage).
const COLUMN_TYPE_DESCRIPTIONS: Record<ColumnType, string> = {
	text: "UTF-8 string",
	uint: "Unsigned integer (Clarity uint) — NUMERIC for lossless 128-bit range",
	int: "Signed integer (Clarity int) — NUMERIC for lossless 128-bit range",
	principal: "Stacks address (standard or contract)",
	boolean: "Boolean value",
	timestamp: "Timestamp with time zone",
	jsonb: "Arbitrary JSON data",
};

// Derived from the subgraphs TYPE_MAP so the type→SQL mapping can't drift behind
// the deployer (which is what actually creates the columns).
export const COLUMN_TYPES: Array<Record<string, unknown>> = [
	...(Object.keys(TYPE_MAP) as ColumnType[]).map((type) => ({
		type,
		sqlType: TYPE_MAP[type],
		description: COLUMN_TYPE_DESCRIPTIONS[type],
	})),
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
	account: "identity, plan, billing, usage, spend caps, and API keys",
	project: "create/manage projects and view their team",
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
	"project",
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
			"Call datasets_list / index_discover / contracts_find to learn what exists (and which filters each surface accepts) before querying.",
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
			projects: orNull(snap?.projects),
			apiKeys: orNull(snap?.apiKeys),
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

	server.resource(
		"traits",
		"secondlayer://traits",
		{
			description:
				"SIP trait standards the platform can classify and scaffold against — the valid values for contracts_find `trait` and subgraph scaffold `--trait`.",
		},
		async () => ({
			contents: [
				{
					uri: "secondlayer://traits",
					mimeType: "application/json",
					text: JSON.stringify(
						{
							traits: TRAIT_STANDARDS.map((id) => ({
								id,
								description: TRAIT_BLURBS[id],
							})),
						},
						null,
						2,
					),
				},
			],
		}),
	);

	server.resource(
		"streams-filters",
		"secondlayer://streams-filters",
		{
			description:
				"Streams firehose vocabulary — the decoded event types and the filter fields accepted by streams_events / streams_consume.",
		},
		async () => ({
			contents: [
				{
					uri: "secondlayer://streams-filters",
					mimeType: "application/json",
					text: JSON.stringify(
						{
							eventTypes: [...DECODED_EVENT_TYPES],
							filters: {
								types: "include only these event types (array)",
								notTypes: "exclude these event types (array)",
								contractId: "match a contract id",
								sender: "match the sender principal",
								recipient: "match the recipient principal",
								assetIdentifier: "match the asset identifier (contract::asset)",
								fromHeight: "start block height (inclusive)",
								toHeight: "end block height (inclusive)",
							},
						},
						null,
						2,
					),
				},
			],
		}),
	);

	server.resource(
		"chain-triggers",
		"secondlayer://chain-triggers",
		{
			description:
				"Chain-subscription trigger types and the filter fields each accepts (for subscriptions_create triggers).",
		},
		async () => ({
			contents: [
				{
					uri: "secondlayer://chain-triggers",
					mimeType: "application/json",
					text: JSON.stringify(CHAIN_TRIGGER_FIELDS, null, 2),
				},
			],
		}),
	);
}
