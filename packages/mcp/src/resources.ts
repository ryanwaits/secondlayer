import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamFilterSchema } from "@secondlayer/shared/schemas";
import { templates as subgraphTemplates } from "@secondlayer/subgraphs/templates";
import { templates as workflowTemplates } from "@secondlayer/workflows/templates";

/** Derived from StreamFilterSchema — single source of truth for filter types and fields. */
const FILTERS_REFERENCE = StreamFilterSchema.options.map((opt) => ({
	type: opt.shape.type.def.values[0] as string,
	fields: Object.keys(opt.shape).filter((k) => k !== "type"),
}));

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
		{ description: "Stream filter types and their available fields" },
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
