import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bundleSubgraphCode } from "@secondlayer/bundler";
import { z } from "zod";
import { getClient } from "../lib/client.ts";
import {
	formatSubgraphSummary,
	jsonResponse,
	textResponse,
	withCap,
} from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";

type SubgraphClientProvider = typeof getClient;

export function registerSubgraphTools(
	server: McpServer,
	clientProvider: SubgraphClientProvider = getClient,
) {
	defineTool<Record<string, never>>(
		server,
		"subgraphs_list",
		"List all deployed subgraphs. Returns summary fields only; read rows with subgraphs_query.",
		{},
		async () => {
			const { data } = await clientProvider().subgraphs.list();
			return jsonResponse(data.map(formatSubgraphSummary));
		},
	);

	defineTool<{ name: string }>(
		server,
		"subgraphs_status",
		"Get full details of a subgraph including schema, health, and table columns.",
		{ name: z.string().describe("Subgraph name") },
		async ({ name }) => {
			const detail = await clientProvider().subgraphs.status(name);
			return jsonResponse(detail);
		},
	);

	defineTool<{ name: string; format?: "agent" | "openapi" | "markdown" }>(
		server,
		"subgraphs_spec",
		"Fetch a subgraph's self-describing spec — the tables, columns, filters, and read URLs a consumer needs, without guessing. `agent` (default) returns the compact JSON schema built for tool use, `openapi` the OpenAPI document for the subgraph's read routes, `markdown` human-readable docs. Read it before writing queries against an unfamiliar subgraph.",
		{
			name: z.string().describe("Subgraph name"),
			format: z
				.enum(["agent", "openapi", "markdown"])
				.optional()
				.describe(
					"agent = JSON schema for tool use (default), openapi = OpenAPI JSON, markdown = docs.md",
				),
		},
		async ({ name, format }) => {
			const client = clientProvider();
			if (format === "openapi")
				return jsonResponse(await client.subgraphs.openapi(name));
			if (format === "markdown")
				return textResponse(await client.subgraphs.markdown(name));
			return jsonResponse(await client.subgraphs.schema(name));
		},
	);

	defineTool<{
		name: string;
		table: string;
		filters?: Record<string, string>;
		sort?: string;
		order?: string;
		limit?: number;
		offset?: number;
		fields?: string;
		count?: boolean;
	}>(
		server,
		"subgraphs_query",
		'Query rows from a subgraph table (max 200 rows). Filters support operators: "amount.gte": "1000", "sender.neq": "SP...", "name.like": "%token%". Available operators: eq, neq, gt, gte, lt, lte, like. To TAIL new rows (no streaming over MCP): sort=_id, order=desc for the latest, then poll forward with the filter {"_id.gt": "<last _id seen>"}, order=asc — when tailing with a `fields` list, include "_id" in it or the next poll filter cannot be formed. Fetch one row by id with {"_id": "<id>"}. The same rows are readable over HTTP at GET /v1/subgraphs/<name>/<table> — { rows, next_cursor, tip } envelope, resume with ?cursor=<next_cursor> + _order=asc|desc (no _offset/_sort on /v1); hand that URL to third parties.',
		{
			name: z.string().describe("Subgraph name"),
			table: z.string().describe("Table name"),
			filters: z
				.record(z.string(), z.string())
				.optional()
				.describe(
					'Column filters — plain values or with operators (e.g. {"amount.gte": "1000", "sender": "SP..."})',
				),
			sort: z.string().optional().describe("Column to sort by"),
			order: z.enum(["asc", "desc"]).optional().describe("Sort order"),
			limit: z
				.number()
				.max(200)
				.optional()
				.describe("Max rows (default 50, max 200)"),
			offset: z.number().optional().describe("Offset for pagination"),
			fields: z
				.string()
				.optional()
				.describe(
					'Comma-separated column list to return (e.g. "sender,amount")',
				),
			count: z
				.boolean()
				.optional()
				.describe("If true, return row count instead of rows"),
		},
		async ({
			name,
			table,
			filters,
			sort,
			order,
			limit,
			offset,
			fields,
			count,
		}) => {
			if (count) {
				const result = await clientProvider().subgraphs.queryTableCount(
					name,
					table,
					{ filters, sort, order },
				);
				return jsonResponse(result);
			}
			const rows = await clientProvider().subgraphs.queryTable(name, table, {
				filters,
				sort,
				order,
				limit: limit ?? 50,
				offset,
				fields,
			});
			const result = withCap(
				rows as Record<string, unknown>[],
				Math.min(limit ?? 50, 200),
			);
			return jsonResponse(result);
		},
	);

	defineTool<{ name: string }>(
		server,
		"subgraphs_reindex",
		"Reindex a subgraph: drops and rebuilds the whole subgraph from its start block to chain tip. Takes no block range — use subgraphs_backfill to process a specific range. Returns an operationId — check subgraphs_status (health) or the REST operations endpoint to track progress to completion.",
		{
			name: z.string().describe("Subgraph name"),
		},
		async ({ name }) => {
			const result = await clientProvider().subgraphs.reindex(name);
			return jsonResponse(result);
		},
	);

	defineTool<{ name: string; fromBlock: number; toBlock: number }>(
		server,
		"subgraphs_backfill",
		"Backfill a subgraph over a block range. Non-destructive forward fill (does not drop existing data) — unlike subgraphs_reindex, and the only data-fill path for BYO subgraphs (reindex is blocked there). Both blocks required. Returns an operationId — check subgraphs_status (health) or the REST operations endpoint to track progress.",
		{
			name: z.string().describe("Subgraph name"),
			fromBlock: z
				.number()
				.int()
				.nonnegative()
				.describe("Start block (inclusive)"),
			toBlock: z.number().int().nonnegative().describe("End block (inclusive)"),
		},
		async ({ name, fromBlock, toBlock }) => {
			const result = await clientProvider().subgraphs.backfill(name, {
				fromBlock,
				toBlock,
			});
			return jsonResponse(result);
		},
	);

	defineTool<{ name: string }>(
		server,
		"subgraphs_stop",
		"Cancel an in-flight reindex or backfill operation for a subgraph. Returns the stop request status; check subgraphs_status (health) or the REST operations endpoint to confirm it reaches a terminal state.",
		{ name: z.string().describe("Subgraph name") },
		async ({ name }) => {
			const result = await clientProvider().subgraphs.stop(name);
			return jsonResponse(result);
		},
	);

	defineTool<{
		name: string;
		limit?: number;
		offset?: number;
		resolved?: boolean;
	}>(
		server,
		"subgraphs_gaps",
		"List indexing gaps (missing block ranges) for a subgraph. Each gap reports start/end/size, reason, and detected/resolved timestamps. Feed an unresolved gap's range into subgraphs_backfill to fill it. Defaults to unresolved gaps.",
		{
			name: z.string().describe("Subgraph name"),
			limit: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Max gaps to return"),
			offset: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe("Pagination offset"),
			resolved: z
				.boolean()
				.optional()
				.describe("Filter by resolved state (omit for unresolved only)"),
		},
		async ({ name, limit, offset, resolved }) => {
			const result = await clientProvider().subgraphs.gaps(name, {
				limit,
				offset,
				resolved,
			});
			return jsonResponse(result);
		},
	);

	defineTool<{ name: string; operationId?: string }>(
		server,
		"subgraphs_operations",
		"Operation history for a subgraph (deploy/reindex/backfill/stop), newest first — status, block range, progress, and error. THIS IS THE VERIFY CALL: after subgraphs_deploy, subgraphs_reindex, subgraphs_backfill, or subgraphs_stop, poll it with the returned operationId until `status` is terminal (completed/failed/cancelled) before reporting success. Omit operationId for the recent history.",
		{
			name: z.string().describe("Subgraph name"),
			operationId: z
				.string()
				.optional()
				.describe(
					"Fetch one operation by id (the operationId returned by reindex/backfill/stop); omit for recent history",
				),
		},
		async ({ name, operationId }) => {
			const client = clientProvider();
			return jsonResponse(
				operationId
					? await client.subgraphs.getOperation(name, operationId)
					: await client.subgraphs.operations(name),
			);
		},
	);

	defineTool<{ name: string }>(
		server,
		"subgraphs_delete",
		"Delete a subgraph permanently.",
		{ name: z.string().describe("Subgraph name") },
		async ({ name }) => {
			const result = await clientProvider().subgraphs.delete(name);
			return textResponse(result.message);
		},
	);

	defineTool<{
		code: string;
		startBlock?: number;
		dryRun?: boolean;
	}>(
		server,
		"subgraphs_deploy",
		"Deploy a subgraph from TypeScript code. Pass the full defineSubgraph() source — it will be bundled, validated, and deployed. Optional startBlock overrides the source definition for this deploy. Set dryRun to validate and preview the schema/DDL without writing anything. Call `subgraphs_reindex` separately if you need a forced reindex.",
		{
			code: z
				.string()
				.describe("TypeScript source code containing a defineSubgraph() call"),
			startBlock: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe("Override the definition startBlock for this deploy"),
			dryRun: z
				.boolean()
				.optional()
				.describe(
					"Validate and preview the deploy (schema/DDL) without writing changes",
				),
		},
		async ({ code, startBlock, dryRun }) => {
			const bundled = await bundleSubgraphCode(code);
			const result = await clientProvider().subgraphs.deploy({
				name: bundled.name,
				version: bundled.version,
				description: bundled.description,
				sources: bundled.sources,
				schema: bundled.schema,
				handlerCode: bundled.handlerCode,
				sourceCode: code,
				...(startBlock !== undefined ? { startBlock } : {}),
				...(dryRun !== undefined ? { dryRun } : {}),
			});
			return jsonResponse(result);
		},
	);
}
