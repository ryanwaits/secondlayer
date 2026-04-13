import { tool } from "ai";
import { z } from "zod";

/**
 * Human-in-the-loop rollback tool — no execute function.
 * Confirming hits POST /api/workflows/:name/rollback which restores the
 * target handler bundle as a new patch version.
 */
export const rollbackWorkflow = tool({
	description:
		"Propose a rollback of a deployed workflow to a prior version. Requires user confirmation. Pass toVersion to pick a specific bundle on disk, or omit to roll back to the immediate previous version. The restored handler is re-published under a new patch version (audit trail).",
	inputSchema: z.object({
		name: z.string().describe("Workflow name"),
		toVersion: z
			.string()
			.regex(/^\d+\.\d+\.\d+$/)
			.optional()
			.describe("Target version (major.minor.patch)"),
		reason: z
			.string()
			.optional()
			.describe("One-line rationale shown on the confirm card."),
	}),
});
