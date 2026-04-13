import { tool } from "ai";
import { z } from "zod";

/**
 * Tail a workflow run in chat. Returns `{ name, runId }`; the card opens an
 * EventSource to `/api/sessions/tail-workflow-run/:name/:runId` and updates
 * the step-flow timeline live as events arrive.
 */
export const tailWorkflowRun = tool({
	description:
		"Tail a workflow run live. Pass the workflow name and the runId returned by the trigger endpoint. The UI opens an SSE stream and renders the step-flow as events arrive. Use this when the user asks to 'watch', 'tail', or 'follow' a run.",
	inputSchema: z.object({
		name: z.string().describe("Workflow name"),
		runId: z.string().describe("Run id to tail"),
	}),
	execute: async ({ name, runId }) => ({ name, runId }),
});
