import { tool } from "ai";
import { z } from "zod";

export const navigate = tool({
	description:
		"Navigate to a page in the app. Use the actionId from the registry.",
	inputSchema: z.object({
		actionId: z
			.string()
			.describe(
				"Action ID from the registry (e.g. 'subgraphs', 'billing', 'settings')",
			),
	}),
	// No execute — terminal tool
});
