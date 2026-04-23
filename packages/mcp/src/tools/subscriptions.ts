import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { getClient } from "../lib/client.ts";
import { defineTool } from "../lib/tool.ts";

/**
 * Subscription MCP tools — let agents list, configure, test, and replay
 * subgraph event subscriptions. Mirrors the HTTP API 1:1; structured
 * errors bubble through the SDK's ApiError.
 */
export function registerSubscriptionTools(server: McpServer) {
	defineTool<Record<string, never>>(
		server,
		"subscriptions_list",
		"List all subscriptions for the current account. Returns summary fields (no secrets).",
		{},
		async () => {
			const { data } = await getClient().subscriptions.list();
			return {
				content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
			};
		},
	);

	defineTool<{ id: string }>(
		server,
		"subscriptions_get",
		"Get full detail for a subscription (filter, auth, retry config, circuit state).",
		{ id: z.string().describe("Subscription id") },
		async ({ id }) => {
			const detail = await getClient().subscriptions.get(id);
			return {
				content: [{ type: "text", text: JSON.stringify(detail, null, 2) }],
			};
		},
	);

	defineTool<{
		name: string;
		subgraphName: string;
		tableName: string;
		url: string;
		format?:
			| "standard-webhooks"
			| "inngest"
			| "trigger"
			| "cloudflare"
			| "cloudevents"
			| "raw";
		runtime?: "inngest" | "trigger" | "cloudflare" | "node";
		filter?: Record<string, unknown>;
	}>(
		server,
		"subscriptions_create",
		"Create a subscription. Returns `signingSecret` ONCE — forward it to the user so they can wire it into their receiver.",
		{
			name: z.string().describe("Human-readable name, unique per account"),
			subgraphName: z.string().describe("Subgraph to subscribe to"),
			tableName: z.string().describe("Table within the subgraph"),
			url: z.string().describe("Webhook URL"),
			format: z
				.enum([
					"standard-webhooks",
					"inngest",
					"trigger",
					"cloudflare",
					"cloudevents",
					"raw",
				])
				.optional()
				.describe("Wire format (default standard-webhooks)"),
			runtime: z
				.enum(["inngest", "trigger", "cloudflare", "node"])
				.optional()
				.describe("Receiver runtime label (display only)"),
			filter: z
				.record(z.string(), z.unknown())
				.optional()
				.describe(
					'Scalar filter DSL, e.g. {"amount": {"gte": 100}, "sender": "SP..."}',
				),
		},
		async (input) => {
			const res = await getClient().subscriptions.create(input);
			return {
				content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
			};
		},
	);

	defineTool<{
		id: string;
		url?: string;
		filter?: Record<string, unknown>;
		format?:
			| "standard-webhooks"
			| "inngest"
			| "trigger"
			| "cloudflare"
			| "cloudevents"
			| "raw";
	}>(
		server,
		"subscriptions_update",
		"Patch a subscription (url, filter, format). Other config fields via dashboard.",
		{
			id: z.string(),
			url: z.string().optional(),
			filter: z.record(z.string(), z.unknown()).optional(),
			format: z
				.enum([
					"standard-webhooks",
					"inngest",
					"trigger",
					"cloudflare",
					"cloudevents",
					"raw",
				])
				.optional(),
		},
		async ({ id, ...patch }) => {
			const res = await getClient().subscriptions.update(id, patch);
			return {
				content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
			};
		},
	);

	defineTool<{ id: string }>(
		server,
		"subscriptions_delete",
		"Delete a subscription. Pending outbox rows are cascade-deleted.",
		{ id: z.string() },
		async ({ id }) => {
			const res = await getClient().subscriptions.delete(id);
			return {
				content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
			};
		},
	);

	defineTool<{ id: string; fromBlock: number; toBlock: number }>(
		server,
		"subscriptions_replay",
		"Replay a block range for a subscription. Replays run at 10% of batch capacity — use sparingly.",
		{
			id: z.string(),
			fromBlock: z.number().int().nonnegative(),
			toBlock: z.number().int().nonnegative(),
		},
		async ({ id, fromBlock, toBlock }) => {
			const res = await getClient().subscriptions.replay(id, {
				fromBlock,
				toBlock,
			});
			return {
				content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
			};
		},
	);

	defineTool<{ id: string }>(
		server,
		"subscriptions_recent_deliveries",
		"Return the last 100 delivery attempts (attempt #, status code, duration, truncated response).",
		{ id: z.string() },
		async ({ id }) => {
			const { data } = await getClient().subscriptions.recentDeliveries(id);
			return {
				content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
			};
		},
	);
}
