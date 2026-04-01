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
		"Manage one or more existing resources (pause, resume, delete, replay, revoke). Supports bulk operations — pass multiple targets for actions like 'pause all streams' or 'delete failed streams'. Returns a confirmation UI — does NOT execute immediately. Use resource IDs from context.",
	inputSchema: z.object({
		action: z
			.enum([
				"pause",
				"resume",
				"disable",
				"enable",
				"replay",
				"delete",
				"revoke",
			])
			.describe("Action to perform on all targets"),
		resourceType: z.enum(["stream", "key"]).describe("Type of resource"),
		targets: z
			.array(targetSchema)
			.min(1)
			.describe("One or more resources to act on"),
	}),
	// No execute — terminal tool
});
