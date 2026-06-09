import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bundleSubgraphCode } from "@secondlayer/bundler";
import { ByoBreakingChangeError } from "@secondlayer/sdk";
import {
	type SubgraphDefinition,
	generateDrizzleSchema,
	generateKyselySchema,
	generatePrismaSchema,
} from "@secondlayer/subgraphs";
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
		format?: "agent" | "openapi" | "markdown";
		serverUrl?: string;
	}>(
		server,
		"subgraphs_spec",
		"Get generated API documentation for a subgraph. Defaults to compact agent schema; supports OpenAPI JSON and Markdown.",
		{
			name: z.string().describe("Subgraph name"),
			format: z
				.enum(["agent", "openapi", "markdown"])
				.optional()
				.describe("Spec format to return. Defaults to agent."),
			serverUrl: z
				.string()
				.optional()
				.describe("Override the server URL embedded in generated docs."),
		},
		async ({ name, format = "agent", serverUrl }) => {
			const options = serverUrl ? { serverUrl } : undefined;
			const spec =
				format === "openapi"
					? await clientProvider().subgraphs.openapi(name, options)
					: format === "markdown"
						? await clientProvider().subgraphs.markdown(name, options)
						: await clientProvider().subgraphs.schema(name, options);
			return {
				content: [
					{
						type: "text",
						text:
							typeof spec === "string" ? spec : JSON.stringify(spec, null, 2),
					},
				],
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

	defineTool<{
		name: string;
		table: string;
		filters?: Record<string, string>;
		count?: boolean;
		countDistinct?: string[];
		sum?: string[];
		min?: string[];
		max?: string[];
	}>(
		server,
		"subgraphs_aggregate",
		'Compute scalar aggregates over a subgraph table\'s filtered rows. Supports count, countDistinct, and sum/min/max (numeric columns only — uint/int plus the system _block_height). Filters use the same grammar as subgraphs_query (e.g. {"amount.gte": "1000"}). sum/min/max come back as lossless strings; counts as numbers. With no aggregate requested, returns the row count.',
		{
			name: z.string().describe("Subgraph name"),
			table: z.string().describe("Table name"),
			filters: z
				.record(z.string(), z.string())
				.optional()
				.describe(
					'Column filters — plain values or with operators (e.g. {"amount.gte": "1000", "sender": "SP..."})',
				),
			count: z
				.boolean()
				.optional()
				.describe("Include COUNT(*) of matching rows"),
			countDistinct: z
				.array(z.string())
				.optional()
				.describe("Columns to count distinct values of"),
			sum: z
				.array(z.string())
				.optional()
				.describe("Numeric columns to sum (lossless string result)"),
			min: z
				.array(z.string())
				.optional()
				.describe("Numeric columns to take the minimum of"),
			max: z
				.array(z.string())
				.optional()
				.describe("Numeric columns to take the maximum of"),
		},
		async ({ name, table, filters, count, countDistinct, sum, min, max }) => {
			const result = await clientProvider().subgraphs.queryTableAggregate(
				name,
				table,
				{ filters, count, countDistinct, sum, min, max },
			);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	defineTool<{ name: string; fromBlock?: number; toBlock?: number }>(
		server,
		"subgraphs_reindex",
		"Reindex a subgraph from a specific block range. Returns an operationId — poll subgraphs_operation to track progress to completion.",
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

	defineTool<{ name: string; operationId?: string }>(
		server,
		"subgraphs_operation",
		"Check reindex/backfill progress. With operationId, returns that operation's status (poll until status is completed/failed/cancelled); without it, lists recent operations for the subgraph.",
		{
			name: z.string().describe("Subgraph name"),
			operationId: z
				.string()
				.optional()
				.describe(
					"Operation id from reindex/backfill/stop; omit to list recent operations",
				),
		},
		async ({ name, operationId }) => {
			const result = operationId
				? await clientProvider().subgraphs.getOperation(name, operationId)
				: await clientProvider().subgraphs.operations(name);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	defineTool<{ name: string; fromBlock: number; toBlock: number }>(
		server,
		"subgraphs_backfill",
		"Backfill a subgraph over a block range. Non-destructive forward fill (does not drop existing data) — unlike subgraphs_reindex, and the only data-fill path for BYO subgraphs (reindex is blocked there). Both blocks required. Returns an operationId — poll subgraphs_operation to track progress.",
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
		"Cancel an in-flight reindex or backfill operation for a subgraph. Returns the stop request status; poll subgraphs_operation to confirm it reaches a terminal state.",
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

	defineTool<{ name: string }>(
		server,
		"subgraphs_read_source",
		"Fetch the deployed TypeScript source of a subgraph (plus its stored version). Returns a readOnly payload for subgraphs deployed before source capture — in that case the caller should redeploy via CLI before editing.",
		{ name: z.string().describe("Subgraph name") },
		async ({ name }) => {
			const source = await clientProvider().subgraphs.getSource(name);
			return {
				content: [{ type: "text", text: JSON.stringify(source, null, 2) }],
			};
		},
	);

	defineTool<{
		code?: string;
		name?: string;
		target?: "prisma" | "drizzle" | "kysely";
		schemaName?: string;
	}>(
		server,
		"subgraphs_codegen",
		"Generate a typed ORM schema (Prisma, Drizzle, or Kysely) for a subgraph's tables so they can be queried from a BYO database. Pass either `code` (defineSubgraph source) or `name` (a deployed subgraph — its captured source is used). Returns the schema as text.",
		{
			code: z
				.string()
				.optional()
				.describe("defineSubgraph() source (mutually exclusive with name)"),
			name: z
				.string()
				.optional()
				.describe("Deployed subgraph name (mutually exclusive with code)"),
			target: z
				.enum(["prisma", "drizzle", "kysely"])
				.optional()
				.describe("ORM target (default prisma)"),
			schemaName: z
				.string()
				.optional()
				.describe("Postgres schema name (defaults to subgraph_<name>)"),
		},
		async ({ code, name, target = "prisma", schemaName }) => {
			if ((code && name) || (!code && !name)) {
				throw new Error("Provide exactly one of `code` or `name`.");
			}
			let source = code;
			if (name) {
				const stored = await clientProvider().subgraphs.getSource(name);
				if (!stored.sourceCode) {
					throw new Error(
						`Subgraph "${name}" has no captured source (deployed before source capture). Redeploy it, or pass its source as \`code\`.`,
					);
				}
				source = stored.sourceCode;
			}
			const bundled = await bundleSubgraphCode(source as string);
			const def: SubgraphDefinition = {
				name: bundled.name,
				version: bundled.version,
				description: bundled.description,
				sources: bundled.sources as unknown as SubgraphDefinition["sources"],
				schema: bundled.schema as SubgraphDefinition["schema"],
				handlers: {},
			};
			const out =
				target === "drizzle"
					? generateDrizzleSchema(def, { schemaName })
					: target === "kysely"
						? generateKyselySchema(def, { schemaName })
						: generatePrismaSchema(def, { schemaName });
			return { content: [{ type: "text", text: out }] };
		},
	);
}
