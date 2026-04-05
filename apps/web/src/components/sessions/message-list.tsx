"use client";

import {
	isTextUIPart,
	isToolUIPart,
	getToolName,
	type UIMessage,
	type UIDataTypes,
	type UITools,
	type ChatStatus,
} from "ai";
import { useEffect, useMemo, useRef } from "react";
import { ToolPartRenderer } from "./tool-part-renderer";
import { StepFlow, type StepInfo } from "./tool-parts/step-flow";

interface MessageListProps {
	messages: UIMessage[];
	status: ChatStatus;
	addToolOutput: (options: { toolCallId: string; output: unknown }) => void;
}

export function MessageList({
	messages,
	status,
	addToolOutput,
}: MessageListProps) {
	const bottomRef = useRef<HTMLDivElement>(null);

	const len = messages.length;
	const lastMsg = messages[len - 1];
	const lastPartCount = lastMsg?.parts.length ?? 0;
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [len, lastPartCount]);

	return (
		<div className="session-messages">
			{messages.map((message) => (
				<MessageBubble
					key={message.id}
					message={message}
					addToolOutput={addToolOutput}
				/>
			))}
			{status === "submitted" && (
				<div className="msg ai">
					<div className="msg-avatar ai-avatar">
						<MiniLogo />
					</div>
					<div className="msg-body">
						<div className="thinking">
							<div className="thinking-dots">
								<span />
								<span />
								<span />
							</div>
							Thinking...
						</div>
					</div>
				</div>
			)}
			<div ref={bottomRef} />
		</div>
	);
}

/** Tools that render visible UI cards (vs invisible helper tools) */
const VISIBLE_TOOLS = new Set([
	"check_subgraphs",
	"check_streams",
	"manage_streams",
	"scaffold_subgraph",
	"recall_sessions",
]);

const TOOL_STEP_LABELS: Record<string, string> = {
	check_subgraphs: "Checking subgraph health",
	check_streams: "Checking stream health",
	manage_streams: "Managing streams",
	scaffold_subgraph: "Generating subgraph code",
	lookup_docs: "Looking up documentation",
	diagnose: "Diagnosing resources",
	recall_sessions: "Searching past sessions",
};

function MessageBubble({
	message,
	addToolOutput,
}: {
	message: UIMessage;
	addToolOutput: (options: { toolCallId: string; output: unknown }) => void;
}) {
	const isUser = message.role === "user";

	// Group parts into render segments: text parts render inline,
	// multiple visible tool parts render as a StepFlow
	const segments = useMemo(() => {
		if (isUser) return null;
		return groupPartsIntoSegments(message.parts, message.id);
	}, [isUser, message.parts, message.id]);

	if (isUser) {
		const text = message.parts
			.filter(isTextUIPart)
			.map((p) => p.text)
			.join("");
		return (
			<div className="msg user">
				<div className="msg-avatar user-avatar">
					<span>R</span>
				</div>
				<div className="msg-body">
					<div className="msg-content user-bubble">{text}</div>
				</div>
			</div>
		);
	}

	return (
		<div className="msg ai">
			<div className="msg-avatar ai-avatar">
				<MiniLogo />
			</div>
			<div className="msg-body">
				{segments?.map((seg) => {
					if (seg.type === "text") {
						if (!seg.text.trim()) return null;
						return (
							<div
								key={seg.key}
								className="msg-content"
								dangerouslySetInnerHTML={{
									__html: formatMarkdown(seg.text),
								}}
							/>
						);
					}
					if (seg.type === "step-flow") {
						return (
							<StepFlow key={seg.key} steps={seg.steps} />
						);
					}
					if (seg.type === "tool") {
						return (
							<ToolPartRenderer
								key={seg.key}
								part={seg.part as Parameters<typeof ToolPartRenderer>[0]["part"]}
								addToolOutput={addToolOutput}
							/>
						);
					}
					return null;
				})}
			</div>
		</div>
	);
}

type Segment =
	| { type: "text"; text: string; key: string }
	| { type: "tool"; part: UIMessage["parts"][number]; key: string }
	| { type: "step-flow"; steps: StepInfo[]; key: string };

function groupPartsIntoSegments(
	parts: UIMessage["parts"][number][],
	msgId: string,
): Segment[] {
	const segments: Segment[] = [];
	let toolBuffer: { part: UIMessage["parts"][number]; index: number }[] = [];

	function flushToolBuffer() {
		if (toolBuffer.length === 0) return;

		if (toolBuffer.length >= 2) {
			// Multiple tool calls → render as step flow
			const totalVisible = toolBuffer.filter((t) =>
				VISIBLE_TOOLS.has(getToolName(t.part as Parameters<typeof getToolName>[0])),
			).length;

			if (totalVisible >= 2) {
				const steps: StepInfo[] = toolBuffer.map((t, stepIdx) => {
					const toolPart = t.part as Parameters<typeof getToolName>[0];
					const toolName = getToolName(toolPart);
					const state = toolPart.state;
					const stepState =
						state === "output-available"
							? "complete"
							: state === "input-streaming"
								? "active"
								: "active";

					return {
						label: `Step ${stepIdx + 1}/${toolBuffer.length} — ${TOOL_STEP_LABELS[toolName] ?? toolName}`,
						state: stepState as StepInfo["state"],
						card: VISIBLE_TOOLS.has(toolName) ? (
							<InlineToolCard part={t.part} />
						) : undefined,
					};
				});

				segments.push({
					type: "step-flow",
					steps,
					key: `${msgId}-steps-${toolBuffer[0].index}`,
				});
				toolBuffer = [];
				return;
			}
		}

		// Single tool or non-visible tools — render individually
		for (const t of toolBuffer) {
			segments.push({
				type: "tool",
				part: t.part,
				key: `${msgId}-tool-${t.index}`,
			});
		}
		toolBuffer = [];
	}

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (isToolUIPart(part)) {
			toolBuffer.push({ part, index: i });
		} else {
			flushToolBuffer();
			if (isTextUIPart(part)) {
				segments.push({
					type: "text",
					text: part.text,
					key: `${msgId}-text-${i}`,
				});
			}
		}
	}
	flushToolBuffer();

	return segments;
}

/** Renders a tool part inline (for use inside StepFlow without addToolOutput) */
function InlineToolCard({ part }: { part: UIMessage["parts"][number] }) {
	const toolPart = part as Parameters<typeof getToolName>[0];
	const toolName = getToolName(toolPart);
	const state = toolPart.state;

	if (state !== "output-available") return null;

	const output = toolPart.output as Record<string, unknown>;

	// Import inline to avoid circular deps — just render minimal status rows
	switch (toolName) {
		case "check_subgraphs": {
			const subs = output.subgraphs as Array<{
				name: string;
				status: string;
				lastProcessedBlock: number | null;
				totalProcessed: number;
			}>;
			return (
				<div className="tool-card">
					{subs?.map((s) => (
						<div key={s.name} className="tool-status-row">
							<span className="tool-status-name">{s.name}</span>
							<span
								className={`tool-badge ${s.status === "active" ? "healthy" : s.status === "error" ? "error" : "syncing"}`}
							>
								{s.status === "active" ? "Healthy" : s.status}
							</span>
							<span className="tool-status-meta">
								{s.lastProcessedBlock != null
									? `block ${s.lastProcessedBlock.toLocaleString()}`
									: "—"}
							</span>
						</div>
					))}
				</div>
			);
		}
		case "check_streams": {
			const streams = output.streams as Array<{
				name: string;
				status: string;
				enabled: boolean;
			}>;
			return (
				<div className="tool-card">
					{streams?.map((s) => (
						<div key={s.name} className="tool-status-row">
							<span className="tool-status-name">{s.name}</span>
							<span
								className={`tool-badge ${s.status === "active" ? "healthy" : s.status === "failed" ? "error" : "paused"}`}
							>
								{s.status === "active" ? "Healthy" : s.status}
							</span>
						</div>
					))}
				</div>
			);
		}
		default:
			return null;
	}
}

function MiniLogo() {
	return (
		<svg viewBox="4 7 40 28" width="18" height="12" fill="none">
			<polygon
				points="8,25 28,17 42,25 22,33"
				fill="rgba(255,255,255,0.15)"
			/>
			<polygon
				points="8,19 28,11 42,19 22,27"
				fill="rgba(255,255,255,0.4)"
			/>
		</svg>
	);
}

function formatMarkdown(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		// Headers
		.replace(/^### (.+)$/gm, '<h4 class="msg-h4">$1</h4>')
		.replace(/^## (.+)$/gm, '<h3 class="msg-h3">$1</h3>')
		// Bold + code
		.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
		.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
		// List items
		.replace(/^- (.+)$/gm, '<div class="msg-li">$1</div>')
		// Line breaks (but not after block elements)
		.replace(/\n(?!<)/g, "<br>");
}
