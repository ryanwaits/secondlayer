import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { apiRequest, getClient } from "../lib/client.ts";
import { jsonResponse } from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";

export function registerAccountTools(server: McpServer) {
	defineTool<Record<string, never>>(
		server,
		"account_whoami",
		"Show the authenticated account's email and plan.",
		{},
		async () => {
			const result = await apiRequest<{ email: string; plan: string }>(
				"GET",
				"/api/accounts/me",
			);
			return jsonResponse(result);
		},
	);

	defineTool<{ product?: "streams" | "index"; name?: string }>(
		server,
		"account_create_key",
		"Mint a scoped streams/index read API key so the agent can self-provision access. Requires an account-level (owner) API key. The returned `key` is shown ONCE — forward it to the user to set as SL_API_KEY.",
		{
			product: z
				.enum(["streams", "index"])
				.optional()
				.describe("Key scope (default streams)"),
			name: z.string().optional().describe("Optional label for the key"),
		},
		async ({ product, name }) =>
			jsonResponse(await getClient().apiKeys.create({ product, name })),
	);
}
