import { tool } from "ai";
import { z } from "zod";

export function createDiagnose() {
	return tool({
		description:
			"Diagnose the health of a stream or subgraph. Analyze resources from your context for: failed status, high error rates (>10%), stalled/behind chain tip (>50 blocks), paused state.",
		inputSchema: z.object({
			resourceType: z
				.enum(["stream", "subgraph"])
				.describe("Type of resource to diagnose"),
			resourceId: z
				.string()
				.optional()
				.describe("Specific resource ID or name. Omit to diagnose all."),
		}),
		execute: async ({ resourceType, resourceId }) => {
			const target = resourceId ? `"${resourceId}"` : `all ${resourceType}s`;
			return {
				instruction: [
					`Analyze ${target} from the resource list in your system prompt.`,
					"Check for: failed/error state, high failure rate (>10%), stalled (>50 blocks behind), paused, zero deliveries.",
					"Respond with your diagnosis inline.",
				].join("\n"),
			};
		},
	});
}
