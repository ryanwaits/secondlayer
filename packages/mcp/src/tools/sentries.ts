import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { getClient } from "../lib/client.ts";
import { defineTool } from "../lib/tool.ts";

export function registerSentryTools(server: McpServer) {
	defineTool<Record<string, never>>(
		server,
		"sentries_list_kinds",
		"Enumerate available sentry kinds with their config shape. Call this first when a user wants to create a sentry so you know which fields each kind expects.",
		{},
		async () => {
			const kinds = getClient().sentries.listKinds();
			return {
				content: [{ type: "text", text: JSON.stringify(kinds, null, 2) }],
			};
		},
	);

	defineTool<Record<string, never>>(
		server,
		"sentries_list",
		"List all sentries on the account. Returns id, kind, name, principal, active state, last check time.",
		{},
		async () => {
			const { data } = await getClient().sentries.list();
			return {
				content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
			};
		},
	);

	defineTool<{ id: string }>(
		server,
		"sentries_get",
		"Get a sentry's full config + recent alert history.",
		{ id: z.string().describe("Sentry id (uuid)") },
		async ({ id }) => {
			const detail = await getClient().sentries.get(id);
			return {
				content: [{ type: "text", text: JSON.stringify(detail, null, 2) }],
			};
		},
	);

	defineTool<{
		kind: string;
		name: string;
		config: Record<string, unknown>;
		delivery_webhook: string;
		active?: boolean;
	}>(
		server,
		"sentries_create",
		"Create a new sentry. Use sentries_list_kinds first to see valid kind values and what config fields each kind expects. `delivery_webhook` is a Slack-compatible https URL.",
		{
			kind: z
				.enum([
					"large-outflow",
					"permission-change",
					"ft-outflow",
					"contract-deployment",
					"print-event-match",
				])
				.describe("Sentry kind — call sentries_list_kinds for details"),
			name: z.string().min(1).max(120).describe("Display name"),
			config: z
				.record(z.string(), z.unknown())
				.describe(
					"Per-kind config object. Shape depends on kind — see sentries_list_kinds for the schema of each.",
				),
			delivery_webhook: z
				.string()
				.url()
				.describe("Slack-compatible webhook URL (https only)"),
			active: z
				.boolean()
				.optional()
				.describe("Whether the sentry is enabled (default true)"),
		},
		async (args) => {
			const { sentry } = await getClient().sentries.create({
				kind: args.kind as Parameters<
					ReturnType<typeof getClient>["sentries"]["create"]
				>[0]["kind"],
				name: args.name,
				config: args.config,
				delivery_webhook: args.delivery_webhook,
				active: args.active,
			});
			return {
				content: [{ type: "text", text: JSON.stringify({ sentry }, null, 2) }],
			};
		},
	);

	defineTool<{
		id: string;
		name?: string;
		config?: Record<string, unknown>;
		delivery_webhook?: string;
		active?: boolean;
	}>(
		server,
		"sentries_update",
		"Update a sentry's config, name, webhook, or active state. Only pass fields you want to change.",
		{
			id: z.string().describe("Sentry id (uuid)"),
			name: z.string().min(1).max(120).optional(),
			config: z.record(z.string(), z.unknown()).optional(),
			delivery_webhook: z.string().url().optional(),
			active: z.boolean().optional(),
		},
		async ({ id, ...patch }) => {
			const { sentry } = await getClient().sentries.update(id, patch);
			return {
				content: [{ type: "text", text: JSON.stringify({ sentry }, null, 2) }],
			};
		},
	);

	defineTool<{ id: string }>(
		server,
		"sentries_delete",
		"Delete a sentry. Alert history is removed and cannot be recovered.",
		{ id: z.string().describe("Sentry id (uuid)") },
		async ({ id }) => {
			const result = await getClient().sentries.delete(id);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	defineTool<{ id: string }>(
		server,
		"sentries_test",
		"Fire a test alert through the sentry's delivery webhook using a synthetic match. Verifies the webhook works end-to-end without waiting for a real match.",
		{ id: z.string().describe("Sentry id (uuid)") },
		async ({ id }) => {
			const result = await getClient().sentries.test(id);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);
}
