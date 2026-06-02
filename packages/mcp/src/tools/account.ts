import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
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

	defineTool<{ displayName?: string; bio?: string; slug?: string }>(
		server,
		"account_update",
		"Update the authenticated account's profile. Requires an API key.",
		{
			displayName: z.string().optional().describe("Display name"),
			bio: z.string().optional().describe("Profile bio"),
			slug: z.string().optional().describe("Account URL slug"),
		},
		async ({ displayName, bio, slug }) => {
			const body: Record<string, string> = {};
			if (displayName !== undefined) body.display_name = displayName;
			if (bio !== undefined) body.bio = bio;
			if (slug !== undefined) body.slug = slug;
			const result = await apiRequest("PATCH", "/api/accounts/me", body);
			return jsonResponse(result);
		},
	);

	defineTool<Record<string, never>>(
		server,
		"account_billing",
		"Show the account's plan and subscription/billing status. Requires an API key.",
		{},
		async () => {
			const result = await apiRequest("GET", "/api/billing/status");
			return jsonResponse(result);
		},
	);
}
