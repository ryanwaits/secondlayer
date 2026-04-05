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

function SessionLoader({ id }: { id: string }) {
	const searchParams = useSearchParams();
	const initialQuery = searchParams.get("q");
	const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);

	useEffect(() => {
		fetch(`/api/sessions/${id}/messages`, { credentials: "same-origin" })
			.then((r) => (r.ok ? r.json() : { messages: [] }))
			.then((data) => {
				const msgs = (data.messages ?? []).filter(
					(m: Record<string, unknown>) => m.role && m.parts,
				);
				setInitialMessages(msgs);
			})
			.catch(() => setInitialMessages([]));
	}, [id]);

	if (initialMessages === null) {
		return (
			<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
				Loading...
			</div>
		);
	}

	return (
		<SessionChat
			id={id}
			initialQuery={initialQuery}
			initialMessages={initialMessages}
		/>
	);
}

function SessionChat({
	id,
	initialQuery,
	initialMessages,
}: {
	id: string;
	initialQuery: string | null;
	initialMessages: UIMessage[];
}) {
	const { addTab, updateTab } = useSessionTabs();
	const initialized = useRef(false);
	const titleGenerated = useRef(false);

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
		<div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
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
				<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
					Loading...
				</div>
			}
		>
			<SessionLoader id={id} />
		</Suspense>
	);
}
