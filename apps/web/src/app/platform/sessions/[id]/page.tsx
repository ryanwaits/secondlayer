"use client";

import { ChatInput } from "@/components/sessions/chat-input";
import { MessageList } from "@/components/sessions/message-list";
import { useSessionTabs } from "@/components/console/tab-bar";
import { useChat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { useSearchParams } from "next/navigation";
import { Suspense, use, useCallback, useEffect, useRef, useState } from "react";

function SessionChat({ id }: { id: string }) {
	const searchParams = useSearchParams();
	const initialQuery = searchParams.get("q");
	const { addTab, updateTab } = useSessionTabs();
	const initialized = useRef(false);
	const titleGenerated = useRef(false);
	const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(
		null,
	);

	// Load persisted messages on mount
	useEffect(() => {
		fetch(`/api/sessions/${id}/messages`, { credentials: "same-origin" })
			.then((r) => (r.ok ? r.json() : { messages: [] }))
			.then((data) => setInitialMessages(data.messages ?? []))
			.catch(() => setInitialMessages([]));
	}, [id]);

	const chat = useChat({
		id,
		api: "/api/sessions/chat",
		body: { chatSessionId: id },
		messages: initialMessages ?? undefined,
		sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
	});

	// Send initial query from URL on first load (only when messages are loaded)
	useEffect(() => {
		if (initialized.current || initialMessages === null) return;
		initialized.current = true;

		if (initialQuery && initialMessages.length === 0) {
			// Add tab immediately with truncated query
			addTab({
				id,
				label: initialQuery.slice(0, 30) + (initialQuery.length > 30 ? "..." : ""),
				href: `/sessions/${id}?q=${encodeURIComponent(initialQuery)}`,
			});
			chat.sendMessage({ text: initialQuery });
		} else if (initialMessages.length > 0) {
			// Restore tab from persisted messages
			const firstUserMsg = initialMessages.find((m) => m.role === "user");
			const label = firstUserMsg
				? firstUserMsg.parts
						.filter((p): p is { type: "text"; text: string } => p.type === "text")
						.map((p) => p.text)
						.join(" ")
						.slice(0, 30) || "Session"
				: "Session";
			addTab({ id, label, href: `/sessions/${id}` });
		}
	}, [id, initialQuery, initialMessages, addTab, chat]);

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
				if (data?.title) updateTab(id, { label: data.title });
			})
			.catch(() => {});
	}, [id, chat.messages, updateTab]);

	const handleSend = useCallback(
		(text: string) => {
			chat.sendMessage({ text });
		},
		[chat],
	);

	// Show loading while fetching persisted messages
	if (initialMessages === null) {
		return (
			<div
				style={{
					flex: 1,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					color: "var(--text-muted)",
					fontSize: 13,
				}}
			>
				Loading...
			</div>
		);
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
			<MessageList
				messages={chat.messages}
				status={chat.status}
				addToolOutput={chat.addToolOutput}
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
				<div
					style={{
						flex: 1,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						color: "var(--text-muted)",
						fontSize: 13,
					}}
				>
					Loading...
				</div>
			}
		>
			<SessionChat id={id} />
		</Suspense>
	);
}
