import { tool } from "ai";
import { z } from "zod";

/**
 * Human-in-the-loop tool for API key management.
 * Supports revoke (destructive) and create actions.
 * No execute — client renders confirmation UI.
 */
export const manageKeys = tool({
	description:
		"Revoke or create API keys. Renders a confirmation card in the UI — the user must click to confirm. ALWAYS use this tool (never describe steps in text) when the user wants to revoke or clean up keys. Call check_keys first to show current keys, then call this with the targets.",
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
