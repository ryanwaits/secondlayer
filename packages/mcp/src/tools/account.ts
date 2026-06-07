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

	defineTool<Record<string, never>>(
		server,
		"account_list_keys",
		"List the account's API keys (metadata only — prefix, name, status, product, tier, last used; never the plaintext). Requires an account-level (owner) API key.",
		{},
		async () => jsonResponse(await getClient().apiKeys.list()),
	);

	defineTool<{ id: string }>(
		server,
		"account_revoke_key",
		"Revoke an API key by id. Requests using that key stop working immediately. Requires an account-level (owner) API key.",
		{ id: z.string().describe("Key id from account_list_keys") },
		async ({ id }) => jsonResponse(await getClient().apiKeys.revoke(id)),
	);

	defineTool<Record<string, never>>(
		server,
		"account_usage",
		"Show the current billing period's usage snapshot: spend (with cap/projection), compute, storage, and per-project breakdown. Requires an API key.",
		{},
		async () => jsonResponse(await apiRequest("GET", "/api/accounts/usage")),
	);

	defineTool<Record<string, never>>(
		server,
		"account_get_caps",
		"Show the account's spend caps and alert threshold. Requires an account-level (owner) API key.",
		{},
		async () => jsonResponse(await apiRequest("GET", "/api/billing/caps")),
	);

	// Bounds the user's own spend — no Stripe, no payment. The Stripe-gated
	// billing routes (upgrade / portal / resolve) are intentionally NOT exposed:
	// they are session-only human-payment flows, not agent actions.
	defineTool<{
		monthlyCapCents?: number;
		computeCapCents?: number;
		storageCapCents?: number;
		alertThresholdPct?: number;
	}>(
		server,
		"account_set_caps",
		"Set the account's spend caps and alert threshold (no payment — just bounds spend). Requires an account-level (owner) API key.",
		{
			monthlyCapCents: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe("Total monthly spend cap in cents"),
			computeCapCents: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe("Compute spend cap in cents"),
			storageCapCents: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe("Storage spend cap in cents"),
			alertThresholdPct: z
				.number()
				.int()
				.min(1)
				.max(100)
				.optional()
				.describe("Percent of cap that triggers an alert (1-100)"),
		},
		async (caps) => {
			const body: Record<string, number> = {};
			for (const [k, v] of Object.entries(caps)) {
				if (v !== undefined) body[k] = v as number;
			}
			return jsonResponse(await apiRequest("PATCH", "/api/billing/caps", body));
		},
	);
}
