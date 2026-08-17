import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest } from "../lib/client.ts";
import { jsonResponse } from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";

export function registerAccountTools(server: McpServer) {
	defineTool<Record<string, never>>(
		server,
		"account_whoami",
		"Show the authenticated account's email.",
		{},
		async () => {
			const result = await apiRequest<{ email: string }>(
				"GET",
				"/api/accounts/me",
			);
			return jsonResponse(result);
		},
	);

	defineTool<{ product?: "streams" | "index"; name?: string }>(
		server,
		"account_create_key",
		"Mint a scoped streams/index read key. Only the metered archive deployment can do this — a self-hosted instance has no account system and returns 404, so on your own instance use the INSTANCE_TOKEN from `secondlayer init` instead. The returned `key` is shown ONCE.",
		{
			product: z
				.enum(["streams", "index"])
				.optional()
				.describe("Key scope (default streams)"),
			name: z.string().optional().describe("Optional label for the key"),
		},
		async ({ product, name }) =>
			jsonResponse(await apiRequest("POST", "/api/keys", { product, name })),
	);
}
