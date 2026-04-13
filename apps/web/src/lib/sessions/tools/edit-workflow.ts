import { tool } from "ai";
import { z } from "zod";

/**
 * Human-in-the-loop edit tool — no execute function.
 * The client fetches a server-rendered diff and shows it on the action card.
 * Confirming triggers the same bundle → deploy path as deploy_workflow with
 * `expectedVersion` set so stale edits 409 on the server.
 */
export const editWorkflow = tool({
	description:
		"Propose an edit to a deployed workflow. Requires user confirmation via a diff card. ALWAYS call read_workflow first to get the current source and version — then pass that exact source as currentCode, your modified version as proposedCode, and the read version as expectedVersion. On 409, re-read and regenerate the diff. Always add the in-flight-run caveat when you confirm.",
	inputSchema: z.object({
		name: z
			.string()
			.regex(/^[a-z][a-z0-9-]*$/)
			.max(63)
			.describe("Workflow name being edited"),
		currentCode: z
			.string()
			.min(1)
			.describe(
				"Source as fetched from read_workflow — used to render the diff.",
			),
		proposedCode: z
			.string()
			.min(1)
			.describe(
				"Proposed new source. Must compile + validate — the confirm path re-bundles before persisting.",
			),
		summary: z
			.string()
			.min(1)
			.describe("One-line summary of the change for the diff card."),
		expectedVersion: z
			.string()
			.regex(/^\d+\.\d+\.\d+$/)
			.describe(
				"Stored version at the time of read_workflow. Server returns 409 on mismatch.",
			),
	}),
});
