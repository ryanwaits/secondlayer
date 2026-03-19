import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../lib/client.ts";
import { formatStreamSummary, formatDeliverySummary, withCap } from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";

/** Filter schema — full 13-type discriminated union for MCP JSON Schema generation. */
const FilterSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stx_transfer"), sender: z.string().optional(), recipient: z.string().optional(), minAmount: z.number().optional(), maxAmount: z.number().optional() }),
  z.object({ type: z.literal("stx_mint"), recipient: z.string().optional(), minAmount: z.number().optional() }),
  z.object({ type: z.literal("stx_burn"), sender: z.string().optional(), minAmount: z.number().optional() }),
  z.object({ type: z.literal("stx_lock"), lockedAddress: z.string().optional(), minAmount: z.number().optional() }),
  z.object({ type: z.literal("ft_transfer"), sender: z.string().optional(), recipient: z.string().optional(), assetIdentifier: z.string().optional(), minAmount: z.number().optional() }),
  z.object({ type: z.literal("ft_mint"), recipient: z.string().optional(), assetIdentifier: z.string().optional(), minAmount: z.number().optional() }),
  z.object({ type: z.literal("ft_burn"), sender: z.string().optional(), assetIdentifier: z.string().optional(), minAmount: z.number().optional() }),
  z.object({ type: z.literal("nft_transfer"), sender: z.string().optional(), recipient: z.string().optional(), assetIdentifier: z.string().optional(), tokenId: z.string().optional() }),
  z.object({ type: z.literal("nft_mint"), recipient: z.string().optional(), assetIdentifier: z.string().optional(), tokenId: z.string().optional() }),
  z.object({ type: z.literal("nft_burn"), sender: z.string().optional(), assetIdentifier: z.string().optional(), tokenId: z.string().optional() }),
  z.object({ type: z.literal("contract_call"), contractId: z.string().optional(), functionName: z.string().optional(), caller: z.string().optional() }),
  z.object({ type: z.literal("contract_deploy"), deployer: z.string().optional(), contractName: z.string().optional() }),
  z.object({ type: z.literal("print_event"), contractId: z.string().optional(), topic: z.string().optional(), contains: z.string().optional() }),
]);

type Filter = z.infer<typeof FilterSchema>;

export function registerStreamTools(server: McpServer) {
  defineTool<{ status?: string }>(
    server,
    "streams_list",
    "List all webhook streams. Returns summary fields only.",
    { status: z.enum(["active", "inactive", "paused", "failed"]).optional().describe("Filter by status") },
    async ({ status }) => {
      const { streams } = await getClient().streams.list(status ? { status } : undefined);
      return {
        content: [{ type: "text", text: JSON.stringify(streams.map(formatStreamSummary), null, 2) }],
      };
    },
  );

  defineTool<{ id: string }>(
    server,
    "streams_get",
    "Get full details of a stream by ID (accepts UUID prefix).",
    { id: z.string().describe("Stream UUID or prefix") },
    async ({ id }) => {
      const stream = await getClient().streams.get(id);
      return { content: [{ type: "text", text: JSON.stringify(stream, null, 2) }] };
    },
  );

  defineTool<{ name: string; endpointUrl: string; filters: Filter[] }>(
    server,
    "streams_create",
    "Create a new webhook stream with filters.",
    {
      name: z.string().describe("Stream name"),
      endpointUrl: z.string().describe("Webhook endpoint URL"),
      filters: z.array(FilterSchema).min(1).describe("Event filters (at least one required)"),
    },
    async ({ name, endpointUrl, filters }) => {
      const result = await getClient().streams.create({ name, endpointUrl, filters });
      return {
        content: [{ type: "text", text: JSON.stringify({ id: result.stream.id, signingSecret: result.signingSecret }, null, 2) }],
      };
    },
  );

  defineTool<{ id: string; name?: string; endpointUrl?: string; filters?: Filter[] }>(
    server,
    "streams_update",
    "Update a stream's name, endpoint, or filters.",
    {
      id: z.string().describe("Stream UUID or prefix"),
      name: z.string().optional().describe("New name"),
      endpointUrl: z.string().optional().describe("New endpoint URL"),
      filters: z.array(FilterSchema).min(1).optional().describe("New filters"),
    },
    async ({ id, name, endpointUrl, filters }) => {
      const data: Record<string, unknown> = {};
      if (name !== undefined) data.name = name;
      if (endpointUrl !== undefined) data.endpointUrl = endpointUrl;
      if (filters !== undefined) data.filters = filters;
      const stream = await getClient().streams.update(id, data as any);
      return { content: [{ type: "text", text: JSON.stringify(formatStreamSummary(stream), null, 2) }] };
    },
  );

  defineTool<{ id: string }>(
    server,
    "streams_delete",
    "Delete a stream permanently.",
    { id: z.string().describe("Stream UUID or prefix") },
    async ({ id }) => {
      await getClient().streams.delete(id);
      return { content: [{ type: "text", text: `Stream ${id} deleted.` }] };
    },
  );

  defineTool<{ id: string; enabled: boolean }>(
    server,
    "streams_toggle",
    "Enable or disable a stream.",
    {
      id: z.string().describe("Stream UUID or prefix"),
      enabled: z.boolean().describe("true to enable, false to disable"),
    },
    async ({ id, enabled }) => {
      const stream = enabled
        ? await getClient().streams.enable(id)
        : await getClient().streams.disable(id);
      return { content: [{ type: "text", text: JSON.stringify({ id: stream.id, status: stream.status }, null, 2) }] };
    },
  );

  defineTool<{ id: string; limit?: number; status?: string }>(
    server,
    "streams_deliveries",
    "List recent deliveries for a stream (max 25).",
    {
      id: z.string().describe("Stream UUID or prefix"),
      limit: z.number().max(25).optional().describe("Max results (default 25)"),
      status: z.string().optional().describe("Filter by delivery status"),
    },
    async ({ id, limit, status }) => {
      const { deliveries } = await getClient().streams.listDeliveries(id, { limit: limit ?? 25, status });
      const result = withCap(deliveries.map(formatDeliverySummary), 25);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  defineTool<{ confirm?: boolean }>(
    server,
    "streams_pause_all",
    "Pause all active streams. Without confirm: true, returns a preview of streams that would be paused.",
    {
      confirm: z.boolean().optional().describe("Set to true to execute. Omit or false for preview only."),
    },
    async ({ confirm }) => {
      if (!confirm) {
        const { streams } = await getClient().streams.list({ status: "active" });
        const names = streams.map((s) => s.name);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ preview: true, count: names.length, streams: names }, null, 2),
          }],
        };
      }
      const result = await getClient().streams.pauseAll();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ paused: result.paused, streams: result.streams.map(formatStreamSummary) }, null, 2),
        }],
      };
    },
  );

  defineTool<{ confirm?: boolean }>(
    server,
    "streams_resume_all",
    "Resume all paused streams. Without confirm: true, returns a preview of streams that would be resumed.",
    {
      confirm: z.boolean().optional().describe("Set to true to execute. Omit or false for preview only."),
    },
    async ({ confirm }) => {
      if (!confirm) {
        const { streams } = await getClient().streams.list({ status: "paused" });
        const names = streams.map((s) => s.name);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ preview: true, count: names.length, streams: names }, null, 2),
          }],
        };
      }
      const result = await getClient().streams.resumeAll();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ resumed: result.resumed, streams: result.streams.map(formatStreamSummary) }, null, 2),
        }],
      };
    },
  );
}
