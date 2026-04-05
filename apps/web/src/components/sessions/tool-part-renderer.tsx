"use client";

import {
	getToolName,
	type ToolUIPart,
	type DynamicToolUIPart,
	type UITools,
} from "ai";
import { SubgraphStatusCard } from "./tool-parts/subgraph-status-card";
import { StreamStatusCard } from "./tool-parts/stream-status-card";
import { ActionCard } from "./tool-parts/action-card";
import { CodeCard } from "./tool-parts/code-card";
import { SuccessBanner } from "./tool-parts/success-banner";
import { ThinkingIndicator } from "./tool-parts/thinking-indicator";
import { MemoryRecallCard } from "./tool-parts/memory-tag";

type AnyToolPart = ToolUIPart<UITools> | DynamicToolUIPart;

interface ToolPartRendererProps {
	part: AnyToolPart;
	addToolOutput: (options: {
		toolCallId: string;
		output: unknown;
	}) => void;
}

const TOOL_LABELS: Record<string, string> = {
	check_subgraphs: "Checking subgraphs...",
	check_streams: "Checking streams...",
	manage_streams: "Preparing action...",
	scaffold_subgraph: "Generating code...",
	lookup_docs: "Looking up docs...",
	diagnose: "Diagnosing...",
	recall_sessions: "Searching past sessions...",
};

export function ToolPartRenderer({ part, addToolOutput }: ToolPartRendererProps) {
	const toolName = getToolName(part);
	const state = part.state;

	// Loading states
	if (state === "input-streaming" || (state === "input-available" && toolName !== "manage_streams")) {
		if (state === "input-available" && hasExecute(toolName)) {
			return <ThinkingIndicator label={TOOL_LABELS[toolName] ?? "Working..."} />;
		}
		return <ThinkingIndicator label={TOOL_LABELS[toolName] ?? "Working..."} />;
	}

	// Human-in-the-loop: manage_streams
	if (toolName === "manage_streams" && state === "input-available") {
		const input = part.input as {
			action: string;
			targets: Array<{ id: string; name: string; reason?: string }>;
		};
		return (
			<ActionCard
				action={input.action}
				targets={input.targets}
				onConfirm={() =>
					addToolOutput({
						toolCallId: part.toolCallId,
						output: { confirmed: true, message: `${input.targets.length} streams ${input.action}d successfully` },
					})
				}
				onCancel={() =>
					addToolOutput({
						toolCallId: part.toolCallId,
						output: { confirmed: false, message: "Action cancelled by user" },
					})
				}
			/>
		);
	}

	// Output states
	if (state === "output-available") {
		const output = part.output as Record<string, unknown>;

		switch (toolName) {
			case "check_subgraphs":
				return (
					<SubgraphStatusCard
						subgraphs={
							output.subgraphs as Array<{
								name: string;
								status: string;
								lastProcessedBlock: number | null;
								totalProcessed: number;
								totalErrors: number;
							}>
						}
					/>
				);

			case "check_streams":
				return (
					<StreamStatusCard
						streams={
							output.streams as Array<{
								id: string;
								name: string;
								status: string;
								enabled: boolean;
								totalDeliveries: number;
								failedDeliveries: number;
								errorMessage: string | null;
							}>
						}
					/>
				);

			case "manage_streams": {
				const msg = (output as { message?: string }).message;
				if ((output as { confirmed?: boolean }).confirmed === false) {
					return <SuccessBanner message={msg ?? "Action cancelled"} />;
				}
				return <SuccessBanner message={msg ?? "Action completed"} />;
			}

			case "scaffold_subgraph": {
				if ((output as { error?: boolean }).error) return null;
				return (
					<CodeCard
						code={(output as { code: string }).code}
						filename={(output as { filename?: string }).filename}
					/>
				);
			}

			case "recall_sessions": {
				const sessions = (output.sessions ?? []) as Array<{
					id: string;
					title: string | null;
					createdAt: string;
					summary: string;
				}>;
				return <MemoryRecallCard sessions={sessions} />;
			}

			// lookup_docs and diagnose don't render UI cards — their output
			// feeds back into the model for a text response
			default:
				return null;
		}
	}

	// Error state
	if (state === "output-error") {
		return (
			<div className="tool-error">
				Tool error: {(part as { errorText?: string }).errorText ?? "Unknown error"}
			</div>
		);
	}

	return null;
}

/** Tools that have server-side execute functions (vs human-in-the-loop) */
function hasExecute(toolName: string): boolean {
	return toolName !== "manage_streams";
}
