import { getSessionFromRequest } from "@/lib/api";
import { buildSessionInstructions } from "@/lib/sessions/instructions";
import {
	createChatSession,
	listRecentSessions,
	persistMessages,
	updateSessionSummary,
} from "@/lib/sessions/persistence";
import { extractSessionSummary } from "@/lib/sessions/summary";
import {
	createSessionTools,
	fetchAccountResources,
} from "@/lib/sessions/tools";
import { anthropic } from "@ai-sdk/anthropic";
import {
	type UIMessage,
	convertToModelMessages,
	stepCountIs,
	streamText,
} from "ai";
import { after } from "next/server";
import { NextResponse } from "next/server";

// Queue persistence work to run after response is sent
let pendingPersist: Promise<void> | null = null;

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

	const [resources, recentSessions] = await Promise.all([
		fetchAccountResources(sessionToken),
		listRecentSessions(sessionToken, 5),
	]);
	const system = buildSessionInstructions(resources, recentSessions);
	const tools = createSessionTools(sessionToken, resources);

	const result = streamText({
		model: anthropic("claude-sonnet-4-20250514"),
		system,
		messages: await convertToModelMessages(messages),
		tools,
		toolChoice: "auto",
		stopWhen: stepCountIs(5),
		maxOutputTokens: 4096,
		prepareStep: async ({ stepNumber }) => {
			// Only phase tools on step 0 of the first message in a session.
			// For follow-up messages (conversation already has history),
			// all tools should be available from the start.
			const isFirstMessage = messages.length <= 1;
			if (stepNumber === 0 && isFirstMessage) {
				return {
					toolChoice: "auto" as const,
					activeTools: [
						"check_subgraphs",
						"check_streams",
						"check_usage",
						"check_keys",
						"check_insights",
						"query_subgraph",
						"lookup_docs",
						"recall_sessions",
						"diagnose",
						"show_code",
					],
				};
			}
			return {};
		},
		onFinish: async ({ response }) => {
			// Use after() to keep serverless function alive for persistence
			const persistWork = async () => {
				try {
					await createChatSession(sessionToken, chatSessionId);
					const allMessages = [
						...messages,
						...response.messages.map((m) => ({
							id: crypto.randomUUID(),
							role: m.role as UIMessage["role"],
							parts:
								"content" in m && Array.isArray(m.content)
									? m.content.map((p) => {
											if ("type" in p && p.type === "text" && "text" in p)
												return {
													type: "text" as const,
													text: String(p.text),
												};
											return p as unknown as UIMessage["parts"][number];
										})
									: [],
						})),
					];
					await persistMessages(
						sessionToken,
						chatSessionId,
						allMessages as UIMessage[],
					);
					const summary = extractSessionSummary(allMessages as UIMessage[]);
					if (summary.toolCalls.length > 0) {
						await updateSessionSummary(sessionToken, chatSessionId, summary);
					}
				} catch (e) {
					console.error("[sessions/chat] Persist error:", e);
				}
			};

			pendingPersist = persistWork();
			after(async () => {
				if (pendingPersist) await pendingPersist;
			});
		},
	});

	return result.toUIMessageStreamResponse();
}
