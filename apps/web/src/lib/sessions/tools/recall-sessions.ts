import { tool } from "ai";
import { z } from "zod";
import { listRecentSessions } from "../persistence";
import { type SessionSummary, formatSummaryForPrompt } from "../summary";

export function createRecallSessions(sessionToken: string) {
	return tool({
		description:
			"Search the user's previous chat sessions for context. Use when the user references past conversations, asks 'what did we do last time', or needs context from a prior session.",
		inputSchema: z.object({
			limit: z
				.number()
				.default(5)
				.describe("Number of recent sessions to return"),
		}),
		execute: async ({ limit }) => {
			const sessions = await listRecentSessions(sessionToken, limit);

			return {
				sessions: sessions.map((s) => ({
					id: s.id,
					title: s.title,
					createdAt: s.created_at,
					summary: s.summary
						? formatSummaryForPrompt(s.summary as SessionSummary)
						: "General conversation",
				})),
			};
		},
	});
}
