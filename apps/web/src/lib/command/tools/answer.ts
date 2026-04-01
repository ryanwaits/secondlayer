import { tool } from "ai";
import { z } from "zod";

export const answer = tool({
	description:
		"Answer an informational question. Use markdown with headers, lists, code blocks. Always call lookup-docs first to ground your answer in real product docs.",
	inputSchema: z.object({
		title: z.string().describe("Short title for the answer"),
		markdown: z.string().describe("Answer in markdown format"),
		docUrl: z.string().optional().describe("Link to relevant documentation"),
	}),
	// No execute — terminal tool, stops the agent loop
});
