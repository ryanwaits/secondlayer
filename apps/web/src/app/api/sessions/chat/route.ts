import { anthropic } from "@ai-sdk/anthropic";
import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { getSessionFromRequest } from "@/lib/api";
import {
	createChatSession,
	listRecentSessions,
	persistMessages,
	updateSessionSummary,
} from "@/lib/sessions/persistence";
import { extractSessionSummary } from "@/lib/sessions/summary";
import { buildSessionInstructions } from "@/lib/sessions/instructions";
import {
	createSessionTools,
	fetchAccountResources,
} from "@/lib/sessions/tools";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { messages, chatSessionId } = (await req.json()) as {
		messages: UIMessage[];
		chatSessionId: string;
	};

	if (!chatSessionId || !messages?.length) {
		return NextResponse.json(
			{ error: "Missing required fields" },
			{ status: 400 },
		);
	}

	// Fetch account resources + recent sessions for system prompt context
	const [resources, recentSessions] = await Promise.all([
		fetchAccountResources(sessionToken),
		listRecentSessions(sessionToken, 5),
	]);
	const system = buildSessionInstructions(resources, recentSessions);
	const tools = createSessionTools(sessionToken);

	const result = streamText({
		model: anthropic("claude-sonnet-4-20250514"),
		system,
		messages: convertToModelMessages(messages),
		tools,
		maxSteps: 5,
		maxOutputTokens: 4096,
		onFinish: async ({ response }) => {
			try {
				await createChatSession(sessionToken, chatSessionId);
				const allMessages = [
					...messages,
					...response.messages.map((m) => ({
						id: m.id,
						role: m.role as UIMessage["role"],
						parts:
							"content" in m
								? Array.isArray(m.content)
									? m.content.map((p: Record<string, unknown>) => {
											if (p.type === "text")
												return { type: "text" as const, text: String(p.text) };
											return p;
										})
									: [{ type: "text" as const, text: String(m.content) }]
								: [],
					})),
				];
				await persistMessages(
					sessionToken,
					chatSessionId,
					allMessages as UIMessage[],
				);
				// Extract and save session summary for cross-session recall
				const summary = extractSessionSummary(allMessages as UIMessage[]);
				if (summary.toolCalls.length > 0) {
					await updateSessionSummary(sessionToken, chatSessionId, summary);
				}
			} catch (e) {
				console.error("[sessions/chat] Persist error:", e);
			}
		},
	});

	return result.toUIMessageStreamResponse();
}
