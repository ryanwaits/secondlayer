import { tool } from "ai";
import { z } from "zod";

const targetSchema = z.object({
	resourceId: z.string().describe("UUID of the resource"),
	resourceName: z
		.string()
		.optional()
		.describe("Display name for the confirmation UI"),
});

export const manageResource = tool({
	description:
		"Manage one or more existing resources (revoke API key). Returns a confirmation UI — does NOT execute immediately. Use resource IDs from context.",
	inputSchema: z.object({
		action: z.enum(["revoke"]).describe("Action to perform on all targets"),
		resourceType: z.enum(["key"]).describe("Type of resource"),
		targets: z
			.array(targetSchema)
			.min(1)
			.describe("One or more resources to act on"),
	}),
});
