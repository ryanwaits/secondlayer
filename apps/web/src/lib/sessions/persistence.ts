import { apiRequest } from "@/lib/api";
import type { Account } from "@/lib/types";
import type { UIMessage } from "ai";

const API_URL = process.env.SL_API_URL || "http://localhost:3800";

/** Resolve account ID from a session token via the backend API */
export async function resolveAccountId(
	sessionToken: string,
): Promise<string | null> {
	try {
		const account = await apiRequest<Account>("/api/accounts/me", {
			sessionToken,
		});
		return account.id;
	} catch {
		return null;
	}
}

/** Create a new chat session row. Returns the session ID. */
export async function createChatSession(
	sessionToken: string,
	chatSessionId: string,
	title?: string,
): Promise<void> {
	await fetch(`${API_URL}/api/chat-sessions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${sessionToken}`,
		},
		body: JSON.stringify({ id: chatSessionId, title: title ?? null }),
	});
}

/** Persist messages for a chat session. Replaces all messages (full snapshot). */
export async function persistMessages(
	sessionToken: string,
	chatSessionId: string,
	messages: UIMessage[],
): Promise<void> {
	await fetch(`${API_URL}/api/chat-sessions/${chatSessionId}/messages`, {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${sessionToken}`,
		},
		body: JSON.stringify({
			messages: messages.map((m) => ({
				role: m.role,
				parts: m.parts,
				metadata: m.metadata ?? null,
			})),
		}),
	});
}

/** Update session summary and title */
export async function updateSessionSummary(
	sessionToken: string,
	chatSessionId: string,
	summary: unknown,
	title?: string,
): Promise<void> {
	await fetch(`${API_URL}/api/chat-sessions/${chatSessionId}`, {
		method: "PATCH",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${sessionToken}`,
		},
		body: JSON.stringify({ summary, ...(title ? { title } : {}) }),
	});
}

/** List recent chat sessions for an account */
export async function listRecentSessions(
	sessionToken: string,
	limit = 5,
): Promise<
	Array<{
		id: string;
		title: string | null;
		summary: unknown;
		created_at: string;
	}>
> {
	const res = await fetch(
		`${API_URL}/api/chat-sessions?limit=${limit}`,
		{ headers: { Authorization: `Bearer ${sessionToken}` } },
	);
	if (!res.ok) return [];
	const data = await res.json();
	return data.sessions ?? [];
}

/** Load messages for a chat session. Returns UIMessage[] shape. */
export async function loadMessages(
	sessionToken: string,
	chatSessionId: string,
): Promise<UIMessage[]> {
	const res = await fetch(
		`${API_URL}/api/chat-sessions/${chatSessionId}/messages`,
		{
			headers: { Authorization: `Bearer ${sessionToken}` },
		},
	);
	if (!res.ok) return [];
	const data = await res.json();
	return (data.messages ?? []).map(
		(m: { id: string; role: string; parts: unknown[]; metadata?: unknown }) => ({
			id: m.id,
			role: m.role as UIMessage["role"],
			parts: m.parts,
			metadata: m.metadata,
		}),
	);
}
