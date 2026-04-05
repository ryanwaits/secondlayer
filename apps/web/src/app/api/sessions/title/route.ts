import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
	const session = getSessionFromRequest(req);
	if (!session) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { message } = await req.json();
	if (!message || typeof message !== "string") {
		return NextResponse.json({ error: "Missing message" }, { status: 400 });
	}

	const { text } = await generateText({
		model: anthropic("claude-haiku-4-5-20251001"),
		maxOutputTokens: 20,
		prompt: `Generate a short title (3-6 words, no quotes) for a chat session that started with this message:\n\n"${message.slice(0, 500)}"`,
	});

	return NextResponse.json({ title: text.trim() });
}
