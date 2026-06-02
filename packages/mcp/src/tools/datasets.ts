import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { getClient } from "../lib/client.ts";
import { jsonResponse } from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";

type ClientProvider = typeof getClient;

export function registerDatasetTools(
	server: McpServer,
	clientProvider: ClientProvider = getClient,
) {
	defineTool<Record<string, never>>(
		server,
		"datasets_list",
		"List the Foundation Datasets catalog with freshness — the discovery endpoint for what dataset slugs exist and how current each is. Reads are public.",
		{},
		async () => {
			const catalog = await clientProvider().datasets.listDatasets();
			return jsonResponse(catalog);
		},
	);

	defineTool<{
		slug: string;
		filters?: Record<string, string>;
		limit?: number;
		cursor?: string;
	}>(
		server,
		"datasets_query",
		'Query a cursor-paginated Foundation Dataset by slug (e.g. "stx-transfers", "sbtc/events", "pox-4/calls", "bns/events"). Filters are passed through as documented query params (e.g. {"sender": "SP...", "from_block": "150000"}). Returns { rows, next_cursor, tip }. Call datasets_list first to discover slugs.',
		{
			slug: z
				.string()
				.describe("Dataset slug from datasets_list (e.g. stx-transfers)"),
			filters: z
				.record(z.string(), z.string())
				.optional()
				.describe("Documented per-dataset query params (snake_case values)"),
			limit: z.number().optional().describe("Max rows for this page"),
			cursor: z
				.string()
				.optional()
				.describe("Opaque cursor from a prior response's next_cursor"),
		},
		async ({ slug, filters, limit, cursor }) => {
			const params: Record<string, unknown> = { ...(filters ?? {}) };
			if (limit !== undefined) params.limit = limit;
			if (cursor !== undefined) params.cursor = cursor;
			const result = await clientProvider().datasets.query(slug, params);
			return jsonResponse(result);
		},
	);
}
