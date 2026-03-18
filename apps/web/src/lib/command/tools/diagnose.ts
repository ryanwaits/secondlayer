import { tool } from "ai";
import { z } from "zod";

export const diagnose = tool({
  description:
    "Diagnose the health of a stream or subgraph. The resource data is in your context (instructions). Analyze the resources for: failed status, high error rates (>10%), stalled/behind chain tip (>50 blocks), paused state. Returns a reminder to analyze — use the answer tool with your diagnosis.",
  inputSchema: z.object({
    resourceType: z.enum(["stream", "subgraph"]).describe("Type of resource to diagnose"),
    resourceId: z
      .string()
      .optional()
      .describe("Specific resource ID or name. If omitted, diagnoses all resources of this type."),
  }),
  execute: async ({ resourceType, resourceId }) => {
    const target = resourceId ? `"${resourceId}"` : `all ${resourceType}s`;
    return [
      `Analyze ${target} from the resource list in your instructions.`,
      "Check for:",
      "- Failed status or error state",
      "- High failure/error rate (>10%)",
      "- Stalled: >50 blocks behind chain tip",
      "- Paused streams (events buffered but not delivered)",
      "- Zero deliveries (new or misconfigured)",
      "",
      "Respond with the answer tool containing your diagnosis as markdown.",
    ].join("\n");
  },
});
