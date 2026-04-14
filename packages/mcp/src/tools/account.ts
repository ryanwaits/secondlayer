import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../lib/client.ts";
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
}
