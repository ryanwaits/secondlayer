import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest } from "../lib/client.ts";
import { jsonResponse } from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";

export function registerAccountTools(server: McpServer) {
	defineTool<Record<string, never>>(
		server,
		"account_whoami",
		"Show the archive account email at api.secondlayer.tools, not the self-host instance.",
		{},
		async () => {
			const result = await apiRequest<{ email: string }>(
				"GET",
				"/api/accounts/me",
			);
			return jsonResponse(result);
		},
	);

	defineTool<{ name?: string }>(
		server,
		"account_create_key",
		"Mint an account key (sk-sl_*) for archive credits, quote, and fetch at api.secondlayer.tools. The returned `key` is shown ONCE.",
		{
			name: z.string().optional().describe("Optional label for the key"),
		},
		async ({ name }) =>
			jsonResponse(await apiRequest("POST", "/api/keys", { name })),
	);
}
