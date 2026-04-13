import { tool } from "ai";
import { z } from "zod";

/**
 * Human-in-the-loop tool — no execute function.
 * The stream stops at `input-available`. The client renders an action card
 * that bundles the source via /api/sessions/bundle-workflow and, on confirm,
 * POSTs to /api/workflows with x-sl-origin: session.
 */
export const deployWorkflow = tool({
	description:
		"Propose deploying a workflow. Requires user confirmation — the client renders a deploy card with the bundle size and trigger summary. Always run scaffold_workflow (or read_workflow) first so you're passing the exact TypeScript source the user just saw. When editing an existing workflow, pass expectedVersion so the server can detect stale edits.",
	inputSchema: z.object({
		name: z
			.string()
			.regex(/^[a-z][a-z0-9-]*$/)
			.max(63)
			.describe("Workflow name"),
		code: z
			.string()
			.min(1)
			.describe(
				"Full TypeScript source for defineWorkflow(). Must be the same source the user saw in the scaffold / diff card.",
			),
		triggerSummary: z
			.string()
			.describe(
				"One-line trigger summary for the card (e.g. 'event · stx_transfer', 'schedule · 0 9 * * *').",
			),
		reason: z
			.string()
			.optional()
			.describe("Short reason / user intent — surfaced on the card."),
		expectedVersion: z
			.string()
			.regex(/^\d+\.\d+\.\d+$/)
			.optional()
			.describe(
				"Stored version the agent is editing from. Triggers a 409 on mismatch so the agent can re-read.",
			),
	}),
});
