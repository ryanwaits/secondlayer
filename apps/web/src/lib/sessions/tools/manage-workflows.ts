import { tool } from "ai";
import { z } from "zod";

/**
 * Human-in-the-loop tool — no execute function.
 * The stream stops at `input-available` state and the UI renders
 * an action card with confirm/cancel buttons. The client calls
 * `addToolOutput()` with the user's decision.
 */
export const manageWorkflows = tool({
	description:
		"Propose an action on one or more workflows (pause, resume, delete, trigger). This requires user confirmation — present the targets and wait for approval. Only use this when the user explicitly asks to take an action on workflows.",
	inputSchema: z.object({
		action: z
			.enum(["pause", "resume", "delete", "trigger"])
			.describe("The action to perform"),
		targets: z
			.array(
				z.object({
					name: z.string().describe("Workflow name"),
					reason: z
						.string()
						.optional()
						.describe("Brief reason why this workflow was selected"),
				}),
			)
			.describe("Workflows to act on"),
		triggerInput: z
			.string()
			.optional()
			.describe(
				"JSON input payload for action='trigger'. REQUIRED when the workflow's handler reads from `ctx.input.X` — call read_workflow first to discover the field names (declaredInput + inputFieldRefs), then extract values from the user's most recent message and pass them here as a JSON object string (e.g. '{\"contractId\": \"SP123...\"}'). If a required field is missing and you cannot extract it, ASK the user before triggering — never fire with `{}` and let the handler throw.",
			),
	}),
});
