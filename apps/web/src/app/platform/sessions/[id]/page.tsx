"use client";

import { ChatInput } from "@/components/sessions/chat-input";
import { MessageList } from "@/components/sessions/message-list";
import { useSessionTabs } from "@/components/console/tab-bar";
import { useChat } from "@ai-sdk/react";
import {
	DefaultChatTransport,
	lastAssistantMessageIsCompleteWithToolCalls,
	type UIMessage,
} from "ai";
import { useSearchParams } from "next/navigation";
import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from "react";

interface SessionData {
	messages: UIMessage[];
	title: string | null;
}

function SessionLoader({ id }: { id: string }) {
	const searchParams = useSearchParams();
	const initialQuery = searchParams.get("q");
	const [data, setData] = useState<SessionData | null>(null);

	useEffect(() => {
		// Fetch messages and session metadata in parallel
		Promise.all([
			fetch(`/api/sessions/${id}/messages`, { credentials: "same-origin" })
				.then((r) => (r.ok ? r.json() : { messages: [] }))
				.catch(() => ({ messages: [] })),
			fetch(`/api/sessions/list`, { credentials: "same-origin" })
				.then((r) => (r.ok ? r.json() : { sessions: [] }))
				.catch(() => ({ sessions: [] })),
		]).then(([msgData, listData]) => {
			const msgs = (msgData.messages ?? [])
				.filter((m: Record<string, unknown>) => {
					if (!m.role || !m.parts) return false;
					// Filter out tool-result messages (intermediate, not for UI)
					if (m.role === "tool") return false;
					return true;
				})
				.map((m: Record<string, unknown>) => {
					const parts = typeof m.parts === "string" ? JSON.parse(m.parts) : m.parts;
					// Filter out tool-call parts from assistant messages
					// (these are model-format, not UI-format — they cause empty bubbles)
					const filteredParts = Array.isArray(parts)
						? parts.filter((p: Record<string, unknown>) =>
							p.type !== "tool-call" && p.type !== "tool-result"
						)
						: parts;
					return { ...m, parts: filteredParts };
				})
				// Remove messages that have no remaining parts after filtering
				.filter((m: Record<string, unknown>) =>
					Array.isArray(m.parts) ? m.parts.length > 0 : true
				);
			const session = (listData.sessions ?? []).find(
				(s: Record<string, unknown>) => s.id === id,
			);
			setData({ messages: msgs, title: session?.title ?? null });
		});
	}, [id]);

	if (data === null) {
		return (
			<div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
				<div style={{ flex: 1 }} />
				<ChatInput onSend={() => {}} disabled />
			</div>
		);
	}

	return (
		<SessionChat
			id={id}
			initialQuery={initialQuery}
			initialMessages={data.messages}
			savedTitle={data.title}
		/>
	);
}

function SessionChat({
	id,
	initialQuery,
	initialMessages,
	savedTitle,
}: {
	id: string;
	initialQuery: string | null;
	initialMessages: UIMessage[];
	savedTitle: string | null;
}) {
	const { addTab, updateTab } = useSessionTabs();
	const initialized = useRef(false);
	const titleGenerated = useRef(savedTitle !== null);

	const transport = useMemo(
		() =>
			new DefaultChatTransport({
				api: "/api/sessions/chat",
				body: { chatSessionId: id },
			}),
		[id],
	);

	const chat = useChat({
		id,
		transport,
		messages: initialMessages.length > 0 ? initialMessages : undefined,
		sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
	});

	// Send initial query or restore tab on first render
	useEffect(() => {
		if (initialized.current) return;
		initialized.current = true;

		if (initialQuery && initialMessages.length === 0) {
			addTab({
				id,
				label: initialQuery.slice(0, 30) + (initialQuery.length > 30 ? "..." : ""),
				href: `/sessions/${id}`,
			});
			window.history.replaceState(null, "", `/sessions/${id}`);
			chat.sendMessage({ text: initialQuery });
		} else if (initialMessages.length > 0) {
			// Use saved DB title if available, otherwise fall back to message text
			const label = savedTitle ?? "Session";
			addTab({ id, label, href: `/sessions/${id}` });
		}
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	// Generate title via LLM after first AI response
	useEffect(() => {
		if (titleGenerated.current) return;
		const firstUserMsg = chat.messages.find((m) => m.role === "user");
		const hasAssistant = chat.messages.some((m) => m.role === "assistant");
		if (!firstUserMsg || !hasAssistant) return;

		titleGenerated.current = true;
		const text = firstUserMsg.parts
			.filter((p): p is { type: "text"; text: string } => p.type === "text")
			.map((p) => p.text)
			.join(" ");

		fetch("/api/sessions/title", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "same-origin",
			body: JSON.stringify({ message: text }),
		})
			.then((r) => (r.ok ? r.json() : null))
			.then((data) => {
				if (data?.title) {
					updateTab(id, { label: data.title });
					fetch(`/api/sessions/${id}`, {
						method: "PATCH",
						headers: { "Content-Type": "application/json" },
						credentials: "same-origin",
						body: JSON.stringify({ title: data.title }),
					}).catch(() => {});
				}
			})
			.catch(() => {});
	}, [id, chat.messages, updateTab]);

	const handleSend = useCallback(
		(text: string) => {
			chat.sendMessage({ text });
		},
		[chat],
	);

	const handleToolOutput = useCallback(
		(options: { toolCallId: string; output: unknown }) => {
			chat.addToolOutput({
				...options,
				tool: "" as never,
			});
		},
		[chat],
	);

	return (
		<div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
			<MessageList
				messages={chat.messages}
				status={chat.status}
				addToolOutput={handleToolOutput}
			/>
			{chat.error && (
				<div className="session-error-bar">
					<span>{chat.error.message || "Something went wrong"}</span>
					<button
						type="button"
						className="tool-btn ghost"
						onClick={() => {
							chat.clearError();
							chat.regenerate();
						}}
					>
						Retry
					</button>
				</div>
			)}
			<ChatInput
				onSend={handleSend}
				disabled={chat.status === "streaming" || chat.status === "submitted"}
			/>
		</div>
	);
}

export default function SessionResultPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = use(params);

	return (
		<Suspense
			fallback={
				<div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
					<div style={{ flex: 1 }} />
				</div>
			}
		>
			<SessionLoader id={id} />
		</Suspense>
	);
}
