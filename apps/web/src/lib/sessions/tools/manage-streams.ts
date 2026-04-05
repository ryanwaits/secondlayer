import { tool } from "ai";
import { z } from "zod";

/**
 * Human-in-the-loop tool — no execute function.
 * The stream stops at `input-available` state and the UI renders
 * an action card with confirm/cancel buttons. The client calls
 * `addToolOutput()` with the user's decision.
 */
export const manageStreams = tool({
	description:
		"Propose an action on one or more streams (pause, resume, delete, replay-failed). This requires user confirmation — present the targets and wait for approval. Only use this when the user explicitly asks to take an action on streams.",
	inputSchema: z.object({
		action: z
			.enum(["pause", "resume", "delete", "replay-failed"])
			.describe("The action to perform"),
		targets: z
			.array(
				z.object({
					id: z.string().describe("Stream ID"),
					name: z.string().describe("Stream name for display"),
					reason: z
						.string()
						.optional()
						.describe("Brief reason why this stream was selected"),
				}),
			)
			.describe("Streams to act on"),
	}),
});
