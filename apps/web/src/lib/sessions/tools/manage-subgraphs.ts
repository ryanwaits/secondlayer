import { tool } from "ai";
import { z } from "zod";

/**
 * Human-in-the-loop tool for subgraph management.
 * Supports reindex, delete, stop, backfill actions.
 * No execute — client renders confirmation UI.
 */
export const manageSubgraphs = tool({
	description:
		"Propose an action on subgraphs — reindex, delete, stop, or backfill. Requires user confirmation. Use when the user asks to reindex, delete, or manage subgraphs.",
	inputSchema: z.object({
		action: z
			.enum(["reindex", "delete", "stop", "backfill"])
			.describe("The action to perform"),
		targets: z
			.array(
				z.object({
					name: z.string().describe("Subgraph name"),
					reason: z
						.string()
						.optional()
						.describe("Brief reason for this action"),
				}),
			)
			.describe("Subgraphs to act on"),
	}),
});
