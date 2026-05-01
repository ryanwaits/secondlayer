import type { SubgraphDetail } from "../schemas/subgraphs.ts";

export type SubgraphSpecFormat = "openapi" | "agent" | "markdown";

export interface SubgraphSpecOptions {
	serverUrl?: string;
	generatedAt?: string;
}

export interface SubgraphAgentSchema {
	name: string;
	version: string;
	description?: string;
	schemaHash?: string;
	generatedAt: string;
	serverUrl: string;
	sources?: Record<string, unknown>;
	tables: Record<
		string,
		{
			endpoint: string;
			countEndpoint: string;
			rowCount: number;
			columns: SubgraphDetail["tables"][string]["columns"];
			indexes?: string[][];
			uniqueKeys?: string[][];
			query: {
				parameters: string[];
				sortable: string[];
				selectable: string[];
				searchable: string[];
				filters: string[];
			};
			examples: {
				list: Record<string, unknown>;
				count: { count: number };
				curl: string;
			};
		}
	>;
}

type ColumnMeta = SubgraphDetail["tables"][string]["columns"][string];

const SYSTEM_COLUMNS = ["_id", "_block_height", "_tx_id", "_created_at"];
const BASE_QUERY_PARAMS = ["_limit", "_offset", "_sort", "_order", "_fields"];
const COMPARISON_OPS = ["neq", "gt", "gte", "lt", "lte"];

function generatedAt(options: SubgraphSpecOptions): string {
	return options.generatedAt ?? new Date().toISOString();
}

function normalizeServerUrl(serverUrl?: string): string {
	return (serverUrl ?? "https://api.secondlayer.tools").replace(/\/+$/, "");
}

function tablePath(subgraphName: string, tableName: string): string {
	return `/api/subgraphs/${subgraphName}/${tableName}`;
}

function countPath(subgraphName: string, tableName: string): string {
	return `${tablePath(subgraphName, tableName)}/count`;
}

function isTextLike(type: string): boolean {
	return type === "text" || type === "principal" || type === "timestamp";
}

function isComparable(type: string): boolean {
	return (
		type === "uint" ||
		type === "int" ||
		type === "bigint" ||
		type === "serial" ||
		type === "timestamp"
	);
}

function exampleForColumn(type: string): unknown {
	switch (type) {
		case "uint":
		case "int":
		case "bigint":
			return "1000";
		case "serial":
			return 1;
		case "principal":
			return "SP000000000000000000002Q6VF78";
		case "timestamp":
			return "2026-01-01T00:00:00.000Z";
		case "boolean":
			return true;
		case "jsonb":
			return { example: true };
		default:
			return "example";
	}
}

function openApiSchemaForColumn(col: ColumnMeta): Record<string, unknown> {
	let schema: Record<string, unknown>;
	switch (col.type) {
		case "uint":
		case "int":
		case "bigint":
			schema = { type: "string", pattern: "^-?\\d+(\\.\\d+)?$" };
			break;
		case "serial":
			schema = { type: "integer" };
			break;
		case "principal":
		case "text":
			schema = { type: "string" };
			break;
		case "timestamp":
			schema = { type: "string", format: "date-time" };
			break;
		case "boolean":
			schema = { type: "boolean" };
			break;
		case "jsonb":
			schema = { type: "object", additionalProperties: true };
			break;
		default:
			schema = {};
			break;
	}
	if (col.nullable) {
		const type = schema.type;
		if (typeof type === "string") schema.type = [type, "null"];
	}
	return schema;
}

function columnEntries(table: SubgraphDetail["tables"][string]) {
	return Object.entries(table.columns);
}

function selectableColumns(table: SubgraphDetail["tables"][string]): string[] {
	return columnEntries(table).map(([name]) => name);
}

function searchableColumns(table: SubgraphDetail["tables"][string]): string[] {
	return columnEntries(table)
		.filter(([, col]) => col.searchable)
		.map(([name]) => name);
}

function filterNames(table: SubgraphDetail["tables"][string]): string[] {
	const result: string[] = [];
	for (const [name, col] of columnEntries(table)) {
		result.push(name);
		result.push(`${name}.neq`);
		if (isComparable(col.type)) {
			for (const op of COMPARISON_OPS.filter((op) => op !== "neq")) {
				result.push(`${name}.${op}`);
			}
		}
		if (isTextLike(col.type)) result.push(`${name}.like`);
	}
	return result;
}

function queryParameters(table: SubgraphDetail["tables"][string]): string[] {
	const params = [...BASE_QUERY_PARAMS];
	if (searchableColumns(table).length > 0) params.push("_search");
	return params;
}

function rowExample(table: SubgraphDetail["tables"][string]) {
	const row: Record<string, unknown> = {};
	for (const [name, col] of columnEntries(table)) {
		row[name] = exampleForColumn(col.type);
	}
	return row;
}

function openApiParameter(
	name: string,
	description: string,
	schema: Record<string, unknown> = { type: "string" },
) {
	return {
		name,
		in: "query",
		required: false,
		description,
		schema,
	};
}

function tableParameters(table: SubgraphDetail["tables"][string]) {
	const parameters = [
		openApiParameter("_limit", "Maximum rows to return.", {
			type: "integer",
			default: 50,
			minimum: 1,
			maximum: 1000,
		}),
		openApiParameter("_offset", "Rows to skip for pagination.", {
			type: "integer",
			default: 0,
			minimum: 0,
		}),
		openApiParameter("_sort", "Column to sort by.", {
			type: "string",
			enum: selectableColumns(table),
		}),
		openApiParameter("_order", "Sort direction.", {
			type: "string",
			enum: ["asc", "desc"],
			default: "asc",
		}),
		openApiParameter("_fields", "Comma-separated columns to include.", {
			type: "string",
		}),
	];
	if (searchableColumns(table).length > 0) {
		parameters.push(
			openApiParameter("_search", "Search across searchable columns.", {
				type: "string",
			}),
		);
	}
	for (const [name, col] of columnEntries(table)) {
		parameters.push(
			openApiParameter(name, `Filter ${name} by equality.`, {
				type: "string",
			}),
		);
		parameters.push(
			openApiParameter(`${name}.neq`, `Filter ${name} by inequality.`, {
				type: "string",
			}),
		);
		if (isComparable(col.type)) {
			for (const op of ["gt", "gte", "lt", "lte"]) {
				parameters.push(
					openApiParameter(`${name}.${op}`, `Filter ${name} with ${op}.`, {
						type: "string",
					}),
				);
			}
		}
		if (isTextLike(col.type)) {
			parameters.push(
				openApiParameter(
					`${name}.like`,
					`Case-insensitive contains filter for ${name}.`,
					{
						type: "string",
					},
				),
			);
		}
	}
	return parameters;
}

export function generateSubgraphAgentSchema(
	detail: SubgraphDetail,
	options: SubgraphSpecOptions = {},
): SubgraphAgentSchema {
	const serverUrl = normalizeServerUrl(options.serverUrl);
	const tables: SubgraphAgentSchema["tables"] = {};
	for (const [tableName, table] of Object.entries(detail.tables)) {
		const path = tablePath(detail.name, tableName);
		tables[tableName] = {
			endpoint: `${serverUrl}${path}`,
			countEndpoint: `${serverUrl}${countPath(detail.name, tableName)}`,
			rowCount: table.rowCount,
			columns: table.columns,
			...(table.indexes ? { indexes: table.indexes } : {}),
			...(table.uniqueKeys ? { uniqueKeys: table.uniqueKeys } : {}),
			query: {
				parameters: queryParameters(table),
				sortable: selectableColumns(table),
				selectable: selectableColumns(table),
				searchable: searchableColumns(table),
				filters: filterNames(table),
			},
			examples: {
				list: rowExample(table),
				count: { count: table.rowCount },
				curl: `curl '${serverUrl}${path}?_limit=10&_sort=_block_height&_order=desc'`,
			},
		};
	}
	return {
		name: detail.name,
		version: detail.version,
		...(detail.description ? { description: detail.description } : {}),
		...(detail.schemaHash ? { schemaHash: detail.schemaHash } : {}),
		generatedAt: generatedAt(options),
		serverUrl,
		...(detail.sources ? { sources: detail.sources } : {}),
		tables,
	};
}

export function generateSubgraphOpenApi(
	detail: SubgraphDetail,
	options: SubgraphSpecOptions = {},
): Record<string, unknown> {
	const serverUrl = normalizeServerUrl(options.serverUrl);
	const paths: Record<string, unknown> = {};
	const schemas: Record<string, unknown> = {};

	for (const [tableName, table] of Object.entries(detail.tables)) {
		const schemaName = `${tableName}Row`;
		const properties: Record<string, unknown> = {};
		const required: string[] = [];
		for (const [columnName, column] of columnEntries(table)) {
			properties[columnName] = openApiSchemaForColumn(column);
			if (!column.nullable) required.push(columnName);
		}
		schemas[schemaName] = {
			type: "object",
			properties,
			required,
			example: rowExample(table),
		};

		paths[tablePath(detail.name, tableName)] = {
			get: {
				summary: `Query ${detail.name}.${tableName}`,
				operationId: `query_${detail.name.replace(/-/g, "_")}_${tableName}`,
				parameters: tableParameters(table),
				responses: {
					"200": {
						description: "Rows returned from the subgraph table.",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										data: {
											type: "array",
											items: { $ref: `#/components/schemas/${schemaName}` },
										},
										meta: {
											type: "object",
											properties: {
												total: { type: "integer" },
												limit: { type: "integer" },
												offset: { type: "integer" },
											},
										},
									},
								},
							},
						},
					},
				},
			},
		};

		paths[countPath(detail.name, tableName)] = {
			get: {
				summary: `Count ${detail.name}.${tableName}`,
				operationId: `count_${detail.name.replace(/-/g, "_")}_${tableName}`,
				parameters: tableParameters(table),
				responses: {
					"200": {
						description: "Row count for the filtered table query.",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: { count: { type: "integer" } },
									required: ["count"],
									example: { count: table.rowCount },
								},
							},
						},
					},
				},
			},
		};
	}

	return {
		openapi: "3.1.0",
		info: {
			title: `${detail.name} Subgraph API`,
			version: detail.version,
			...(detail.description ? { description: detail.description } : {}),
		},
		servers: [{ url: serverUrl }],
		paths,
		components: { schemas },
		"x-secondlayer-subgraph": detail.name,
		"x-secondlayer-version": detail.version,
		"x-secondlayer-schema-hash": detail.schemaHash,
		"x-secondlayer-generated-at": generatedAt(options),
		"x-secondlayer-sources": detail.sources ?? {},
		"x-secondlayer-tables": Object.keys(detail.tables),
	};
}

export function generateSubgraphMarkdown(
	detail: SubgraphDetail,
	options: SubgraphSpecOptions = {},
): string {
	const agent = generateSubgraphAgentSchema(detail, options);
	const lines = [
		`# ${detail.name} Subgraph API`,
		"",
		`Version: ${detail.version}`,
		detail.schemaHash ? `Schema hash: ${detail.schemaHash}` : undefined,
		`Server: ${agent.serverUrl}`,
		"",
		detail.description,
	].filter((line): line is string => line !== undefined && line !== "");

	for (const [tableName, table] of Object.entries(agent.tables)) {
		lines.push(
			"",
			`## ${tableName}`,
			"",
			`GET ${table.endpoint}`,
			`GET ${table.countEndpoint}`,
			"",
			`Rows: ${table.rowCount}`,
			"",
			"### Columns",
			"",
			"| Column | Type | Attributes |",
			"| --- | --- | --- |",
		);
		for (const [columnName, col] of Object.entries(table.columns)) {
			const attrs = [
				SYSTEM_COLUMNS.includes(columnName) ? "system" : undefined,
				col.nullable ? "nullable" : undefined,
				col.indexed ? "indexed" : undefined,
				col.searchable ? "searchable" : undefined,
			]
				.filter(Boolean)
				.join(", ");
			lines.push(`| \`${columnName}\` | \`${col.type}\` | ${attrs || "-"} |`);
		}
		lines.push(
			"",
			"### Query",
			"",
			`Parameters: ${table.query.parameters.map((p) => `\`${p}\``).join(", ")}`,
			`Filters: ${table.query.filters.map((p) => `\`${p}\``).join(", ")}`,
			"",
			"### Example",
			"",
			"```bash",
			table.examples.curl,
			"```",
		);
	}
	return `${lines.join("\n")}\n`;
}

export function generateSubgraphSpec(
	detail: SubgraphDetail,
	format: SubgraphSpecFormat,
	options: SubgraphSpecOptions = {},
): Record<string, unknown> | SubgraphAgentSchema | string {
	if (format === "openapi") return generateSubgraphOpenApi(detail, options);
	if (format === "agent") return generateSubgraphAgentSchema(detail, options);
	return generateSubgraphMarkdown(detail, options);
}
