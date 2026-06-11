import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bundleSubgraphCode } from "@secondlayer/bundler";
import { ByoBreakingChangeError } from "@secondlayer/sdk";
import { z } from "zod/v4";
import { getClient } from "../lib/client.ts";
import { formatSubgraphSummary, withCap } from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";

type SubgraphClientProvider = typeof getClient;

export function registerSubgraphTools(
	server: McpServer,
	clientProvider: SubgraphClientProvider = getClient,
) {
	defineTool<Record<string, never>>(
		server,
		"subgraphs_list",
		"List all deployed subgraphs. Returns summary fields only, including visibility — public subgraphs are anon-readable at /v1/subgraphs/<name>.",
		{},
		async () => {
			const { data } = await clientProvider().subgraphs.list();
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(data.map(formatSubgraphSummary), null, 2),
					},
				],
			};
		},
	);

	defineTool<{ name: string }>(
		server,
		"subgraphs_get",
		"Get full details of a subgraph including schema, health, and table columns.",
		{ name: z.string().describe("Subgraph name") },
		async ({ name }) => {
			const detail = await clientProvider().subgraphs.get(name);
			return {
				content: [{ type: "text", text: JSON.stringify(detail, null, 2) }],
			};
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
		'Query rows from a subgraph table (max 200 rows). Filters support operators: "amount.gte": "1000", "sender.neq": "SP...", "name.like": "%token%". Available operators: eq, neq, gt, gte, lt, lte, like. To TAIL new rows (no streaming over MCP): sort=_id, order=desc for the latest, then poll forward with the filter {"_id.gt": "<last _id seen>"}, order=asc. Fetch one row by id with {"_id": "<id>"}. Public subgraphs are also keyless over HTTP at GET /v1/subgraphs/<name>/<table> — { rows, next_cursor, tip } envelope, resume with ?cursor=<next_cursor> + _order=asc|desc (no _offset/_sort on /v1); hand that URL to third parties.',
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
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			}
			const rows = await clientProvider().subgraphs.queryTable(name, table, {
				filters,
				sort,
				order,
				limit: limit ?? 50,
				offset,
				fields,
			});
			const cap = limit ?? 50;
			const result = withCap(
				rows as Record<string, unknown>[],
				cap > 200 ? 200 : cap,
			);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	defineTool<{ name: string; fromBlock?: number; toBlock?: number }>(
		server,
		"subgraphs_reindex",
		"Reindex a subgraph from a specific block range. Returns an operationId — check subgraphs_get (health) or the REST operations endpoint to track progress to completion.",
		{
			name: z.string().describe("Subgraph name"),
			fromBlock: z
				.number()
				.optional()
				.describe("Start block (defaults to beginning)"),
			toBlock: z.number().optional().describe("End block (defaults to latest)"),
		},
		async ({ name, fromBlock, toBlock }) => {
			const result = await clientProvider().subgraphs.reindex(name, {
				fromBlock,
				toBlock,
			});
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	defineTool<{ name: string; fromBlock: number; toBlock: number }>(
		server,
		"subgraphs_backfill",
		"Backfill a subgraph over a block range. Non-destructive forward fill (does not drop existing data) — unlike subgraphs_reindex, and the only data-fill path for BYO subgraphs (reindex is blocked there). Both blocks required. Returns an operationId — check subgraphs_get (health) or the REST operations endpoint to track progress.",
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
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	defineTool<{ name: string }>(
		server,
		"subgraphs_stop",
		"Cancel an in-flight reindex or backfill operation for a subgraph. Returns the stop request status; check subgraphs_get (health) or the REST operations endpoint to confirm it reaches a terminal state.",
		{ name: z.string().describe("Subgraph name") },
		async ({ name }) => {
			const result = await clientProvider().subgraphs.stop(name);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
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
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	defineTool<{ name: string }>(
		server,
		"subgraphs_delete",
		"Delete a subgraph permanently.",
		{ name: z.string().describe("Subgraph name") },
		async ({ name }) => {
			const result = await clientProvider().subgraphs.delete(name);
			return { content: [{ type: "text", text: result.message }] };
		},
	);

	defineTool<{
		code: string;
		startBlock?: number;
		databaseUrl?: string;
		dryRun?: boolean;
		visibility?: "public" | "private";
	}>(
		server,
		"subgraphs_deploy",
		"Deploy a subgraph from TypeScript code. Pass the full defineSubgraph() source — it will be bundled, validated, and deployed. Optional startBlock overrides the source definition for this deploy. Set dryRun to validate and preview the schema/DDL without writing anything. Set databaseUrl to deploy to your own Postgres (BYO data plane) — the server verifies the connection first; with dryRun it returns the DDL + grant script. A breaking BYO schema change is refused and returns a migration plan (drop + rebuild DDL) instead of deploying. Visibility defaults: managed deploys are public (anon-readable at /v1/subgraphs/<name>, name claimed in the global public namespace), BYO deploys are private. Call `subgraphs_reindex` separately if you need a forced reindex.",
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
			databaseUrl: z
				.string()
				.optional()
				.describe(
					"BYO data plane: Postgres connection string to host the subgraph's schema and rows in your own database",
				),
			dryRun: z
				.boolean()
				.optional()
				.describe(
					"Validate and preview the deploy (schema/DDL, BYO connection) without writing changes",
				),
			visibility: z
				.enum(["public", "private"])
				.optional()
				.describe(
					"Read visibility: public = anon /v1 reads + global name claim; private = owning account's key only. Defaults: managed → public, BYO → private.",
				),
		},
		async ({ code, startBlock, databaseUrl, dryRun, visibility }) => {
			const bundled = await bundleSubgraphCode(code);
			try {
				const result = await clientProvider().subgraphs.deploy({
					name: bundled.name,
					version: bundled.version,
					description: bundled.description,
					sources: bundled.sources,
					schema: bundled.schema,
					handlerCode: bundled.handlerCode,
					sourceCode: code,
					...(startBlock !== undefined ? { startBlock } : {}),
					...(databaseUrl !== undefined ? { databaseUrl } : {}),
					...(dryRun !== undefined ? { dryRun } : {}),
					...(visibility !== undefined ? { visibility } : {}),
				});
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (err) {
				// A refused BYO breaking change is an actionable result, not a failure:
				// defineTool would flatten the throw to {error:{message}} and drop the
				// migration plan, so surface reasons/diff/plan as a normal result.
				if (err instanceof ByoBreakingChangeError) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{ byoBreakingChange: true, ...err.details },
									null,
									2,
								),
							},
						],
					};
				}
				throw err;
			}
		},
	);

	defineTool<{ name: string }>(
		server,
		"subgraphs_publish",
		"Make a subgraph publicly readable at /v1/subgraphs/<name> — anyone (or any agent) can read it without a key. Claims the name in the global public namespace; fails with PUBLIC_NAME_TAKEN if another account holds it.",
		{ name: z.string().describe("Subgraph name") },
		async ({ name }) => {
			const result = await clientProvider().subgraphs.publish(name);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	defineTool<{ name: string }>(
		server,
		"subgraphs_unpublish",
		"Make a subgraph private again — /v1 reads then require the owning account's bearer key, and the global public name claim is released.",
		{ name: z.string().describe("Subgraph name") },
		async ({ name }) => {
			const result = await clientProvider().subgraphs.unpublish(name);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);

}
