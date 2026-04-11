import { getSessionFromRequest } from "@/lib/api";
import {
	loadMessages,
	persistMessages,
	updateSessionSummary,
} from "@/lib/sessions/persistence";
import { extractSessionSummary } from "@/lib/sessions/summary";
import type { UIMessage } from "ai";
import { NextResponse } from "next/server";

export async function GET(
	req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { id } = await params;
	const messages = await loadMessages(sessionToken, id);
	return NextResponse.json({ messages });
}

export async function PUT(
	req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { id } = await params;
	const { messages } = (await req.json()) as {
		messages: Array<{ role: string; parts: unknown; metadata?: unknown }>;
	};

	if (!messages?.length) {
		return NextResponse.json({ error: "Missing messages" }, { status: 400 });
	}

	await persistMessages(sessionToken, id, messages as UIMessage[]);

	// Extract and update session summary from UI-format messages
	const summary = extractSessionSummary(messages as UIMessage[]);
	if (summary.toolCalls.length > 0) {
		await updateSessionSummary(sessionToken, id, summary);
	}

	return NextResponse.json({ ok: true });
}
