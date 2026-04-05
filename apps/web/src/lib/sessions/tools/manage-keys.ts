import { tool } from "ai";
import { z } from "zod";

/**
 * Human-in-the-loop tool for API key management.
 * Supports revoke (destructive) and create actions.
 * No execute — client renders confirmation UI.
 */
export const manageKeys = tool({
	description:
		"Propose an action on API keys — revoke existing keys or create a new one. Requires user confirmation. Use when the user asks to delete, revoke, or create API keys.",
	inputSchema: z.object({
		action: z
			.enum(["revoke", "create"])
			.describe("The action to perform"),
		targets: z
			.array(
				z.object({
					id: z.string().describe("Key ID (for revoke) or empty for create"),
					name: z.string().describe("Key name for display"),
					reason: z
						.string()
						.optional()
						.describe("Brief reason for this action"),
				}),
			)
			.describe("Keys to act on"),
	}),
});
