import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { templates as subgraphTemplates } from "@secondlayer/subgraphs/templates";
import { templates as workflowTemplates } from "@secondlayer/workflows/templates";

/** Filter types for blockchain events — SubgraphFilter vocabulary. */
const FILTERS_REFERENCE = [
	{ type: "stx_transfer", fields: ["sender", "recipient", "minAmount", "maxAmount"] },
	{ type: "stx_mint", fields: ["recipient", "minAmount"] },
	{ type: "stx_burn", fields: ["sender", "minAmount"] },
	{ type: "stx_lock", fields: ["lockedAddress", "minAmount"] },
	{ type: "ft_transfer", fields: ["sender", "recipient", "assetIdentifier", "minAmount", "maxAmount"] },
	{ type: "ft_mint", fields: ["recipient", "assetIdentifier", "minAmount"] },
	{ type: "ft_burn", fields: ["sender", "assetIdentifier", "minAmount"] },
	{ type: "nft_transfer", fields: ["sender", "recipient", "assetIdentifier", "tokenId"] },
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

export function registerResources(server: McpServer) {
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
		"templates",
		"secondlayer://templates",
		{
			description:
				"Available subgraph and workflow templates with descriptions and categories",
		},
		async () => ({
			contents: [
				{
					uri: "secondlayer://templates",
					mimeType: "application/json",
					text: JSON.stringify(
						[
							...subgraphTemplates.map(
								({ id, name, description, category }) => ({
									kind: "subgraph" as const,
									id,
									name,
									description,
									category,
								}),
							),
							...workflowTemplates.map(
								({ id, name, description, category, trigger }) => ({
									kind: "workflow" as const,
									id,
									name,
									description,
									category,
									trigger,
								}),
							),
						],
						null,
						2,
					),
				},
			],
		}),
	);
}
