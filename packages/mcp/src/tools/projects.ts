import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { getClient } from "../lib/client.ts";
import { jsonResponse } from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";

type ClientProvider = typeof getClient;

export function registerProjectTools(
	server: McpServer,
	clientProvider: ClientProvider = getClient,
) {
	defineTool<Record<string, never>>(
		server,
		"project_list",
		"List the account's projects. Requires an account-level (owner) API key.",
		{},
		async () => jsonResponse(await clientProvider().projects.list()),
	);

	defineTool<{ slug: string }>(
		server,
		"project_get",
		"Get a single project by slug.",
		{ slug: z.string().describe("Project slug") },
		async ({ slug }) => jsonResponse(await clientProvider().projects.get(slug)),
	);

	defineTool<{
		name: string;
		slug?: string;
		network?: string;
		nodeRpc?: string;
	}>(
		server,
		"project_create",
		"Create a project. The slug is derived from the name when omitted. Requires an account-level (owner) API key.",
		{
			name: z.string().describe("Project name"),
			slug: z
				.string()
				.optional()
				.describe("URL slug (auto-derived from name if omitted)"),
			network: z
				.string()
				.optional()
				.describe("Network (e.g. mainnet, testnet)"),
			nodeRpc: z.string().optional().describe("Custom node RPC URL"),
		},
		async ({ name, slug, network, nodeRpc }) =>
			jsonResponse(
				await clientProvider().projects.create({
					name,
					slug,
					network,
					nodeRpc,
				}),
			),
	);

	defineTool<{
		slug: string;
		newSlug?: string;
		name?: string;
		network?: string;
		nodeRpc?: string;
		settings?: Record<string, unknown>;
	}>(
		server,
		"project_update",
		"Update a project. `slug` selects the project; `newSlug` renames it. Requires an account-level (owner) API key.",
		{
			slug: z.string().describe("Slug of the project to update"),
			newSlug: z.string().optional().describe("New slug (renames the project)"),
			name: z.string().optional().describe("New display name"),
			network: z
				.string()
				.optional()
				.describe("Network (e.g. mainnet, testnet)"),
			nodeRpc: z.string().optional().describe("Custom node RPC URL"),
			settings: z
				.record(z.string(), z.unknown())
				.optional()
				.describe("Arbitrary project settings to merge"),
		},
		async ({ slug, newSlug, name, network, nodeRpc, settings }) =>
			jsonResponse(
				await clientProvider().projects.update(slug, {
					...(newSlug !== undefined ? { slug: newSlug } : {}),
					...(name !== undefined ? { name } : {}),
					...(network !== undefined ? { network } : {}),
					...(nodeRpc !== undefined ? { nodeRpc } : {}),
					...(settings !== undefined ? { settings } : {}),
				}),
			),
	);

	defineTool<{ slug: string }>(
		server,
		"project_delete",
		"Delete a project permanently. The account's last remaining project cannot be deleted.",
		{ slug: z.string().describe("Project slug") },
		async ({ slug }) =>
			jsonResponse(await clientProvider().projects.delete(slug)),
	);

	defineTool<{ slug: string }>(
		server,
		"project_team_list",
		"List a project's team members and pending invitations.",
		{ slug: z.string().describe("Project slug") },
		async ({ slug }) =>
			jsonResponse(await clientProvider().projects.team(slug)),
	);
}
