import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../lib/client.ts";
import { formatSubgraphSummary, withCap } from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";
import { bundleSubgraphCode } from "../lib/bundle.ts";

export function registerSubgraphTools(server: McpServer) {
  defineTool<Record<string, never>>(
    server,
    "subgraphs_list",
    "List all deployed subgraphs. Returns summary fields only.",
    {},
    async () => {
      const { data } = await getClient().subgraphs.list();
      return {
        content: [{ type: "text", text: JSON.stringify(data.map(formatSubgraphSummary), null, 2) }],
      };
    },
  );

  defineTool<{ name: string }>(
    server,
    "subgraphs_get",
    "Get full details of a subgraph including schema, health, and table columns.",
    { name: z.string().describe("Subgraph name") },
    async ({ name }) => {
      const detail = await getClient().subgraphs.get(name);
      return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }] };
    },
  );

  defineTool<{
    name: string; table: string; filters?: Record<string, string>;
    sort?: string; order?: string; limit?: number; offset?: number;
  }>(
    server,
    "subgraphs_query",
    "Query rows from a subgraph table (max 50 rows).",
    {
      name: z.string().describe("Subgraph name"),
      table: z.string().describe("Table name"),
      filters: z.record(z.string(), z.string()).optional().describe("Column filters as key-value pairs (e.g. {\"sender\": \"SP...\"})"),
      sort: z.string().optional().describe("Column to sort by"),
      order: z.enum(["asc", "desc"]).optional().describe("Sort order"),
      limit: z.number().max(50).optional().describe("Max rows (default 50)"),
      offset: z.number().optional().describe("Offset for pagination"),
    },
    async ({ name, table, filters, sort, order, limit, offset }) => {
      const rows = await getClient().subgraphs.queryTable(name, table, {
        filters,
        sort,
        order,
        limit: limit ?? 50,
        offset,
      });
      const result = withCap(rows as Record<string, unknown>[], 50);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  defineTool<{ name: string; fromBlock?: number; toBlock?: number }>(
    server,
    "subgraphs_reindex",
    "Reindex a subgraph from a specific block range.",
    {
      name: z.string().describe("Subgraph name"),
      fromBlock: z.number().optional().describe("Start block (defaults to beginning)"),
      toBlock: z.number().optional().describe("End block (defaults to latest)"),
    },
    async ({ name, fromBlock, toBlock }) => {
      const result = await getClient().subgraphs.reindex(name, { fromBlock, toBlock });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  defineTool<{ name: string }>(
    server,
    "subgraphs_delete",
    "Delete a subgraph permanently.",
    { name: z.string().describe("Subgraph name") },
    async ({ name }) => {
      const result = await getClient().subgraphs.delete(name);
      return { content: [{ type: "text", text: result.message }] };
    },
  );

  defineTool<{ code: string; reindex?: boolean }>(
    server,
    "subgraphs_deploy",
    "Deploy a subgraph from TypeScript code. Pass the full defineSubgraph() source — it will be bundled, validated, and deployed.",
    {
      code: z.string().describe("TypeScript source code containing a defineSubgraph() call"),
      reindex: z.boolean().optional().describe("Force reindex on breaking schema change (drops and rebuilds all data)"),
    },
    async ({ code, reindex }) => {
      const bundled = await bundleSubgraphCode(code);
      const result = await getClient().subgraphs.deploy({
        name: bundled.name,
        version: bundled.version,
        description: bundled.description,
        sources: bundled.sources,
        schema: bundled.schema,
        handlerCode: bundled.handlerCode,
        reindex,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
