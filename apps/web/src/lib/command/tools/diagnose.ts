import { tool } from "ai";
import { z } from "zod";

export const diagnose = tool({
	description:
		"Diagnose the health of a subgraph. The resource data is in your context (instructions). Analyze the resources for: error state, stalled/behind chain tip (>50 blocks). Returns a reminder to analyze — use the answer tool with your diagnosis.",
	inputSchema: z.object({
		resourceType: z.enum(["subgraph"]).describe("Type of resource to diagnose"),
		resourceId: z
			.string()
			.optional()
			.describe(
				"Specific resource ID or name. If omitted, diagnoses all resources of this type.",
			),
	}),
	execute: async ({ resourceType, resourceId }) => {
		const target = resourceId ? `"${resourceId}"` : `all ${resourceType}s`;
		return [
			`Analyze ${target} from the resource list in your instructions.`,
			"Check for:",
			"- Error state",
			"- Stalled: >50 blocks behind chain tip",
			"",
			"Respond with the answer tool containing your diagnosis as markdown.",
		].join("\n");
	},
});
