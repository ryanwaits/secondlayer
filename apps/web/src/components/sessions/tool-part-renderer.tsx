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
import { KeysCard } from "./tool-parts/keys-card";
import { InsightsCard } from "./tool-parts/insights-card";
import { SuccessBanner } from "./tool-parts/success-banner";
import { MemoryRecallCard } from "./tool-parts/memory-tag";
import { ToolCallIndicator } from "./tool-parts/tool-call-indicator";

type AnyToolPart = ToolUIPart<UITools> | DynamicToolUIPart;

interface ToolPartRendererProps {
	part: AnyToolPart;
	addToolOutput: (options: {
		toolCallId: string;
		output: unknown;
	}) => void;
}

const HUMAN_IN_LOOP_TOOLS = new Set([
	"manage_streams",
	"manage_keys",
	"manage_subgraphs",
]);

export function ToolPartRenderer({ part, addToolOutput }: ToolPartRendererProps) {
	const toolName = getToolName(part);
	const state = part.state;

	// Loading state — show indicator with dots
	if (state === "input-streaming") {
		return (
			<ToolCallIndicator
				toolName={toolName}
				state={state}
				input={part.input}
			/>
		);
	}

	// Tools with execute waiting to run — show indicator with dots
	if (state === "input-available" && !HUMAN_IN_LOOP_TOOLS.has(toolName)) {
		return (
			<ToolCallIndicator
				toolName={toolName}
				state={state}
				input={part.input}
			/>
		);
	}

	// Human-in-the-loop tools — show indicator + action card
	if (state === "input-available" && HUMAN_IN_LOOP_TOOLS.has(toolName)) {
		const input = part.input as {
			action: string;
			targets: Array<{ id?: string; name: string; reason?: string }>;
		};
		const resourceType = toolName === "manage_keys" ? "keys" : toolName === "manage_subgraphs" ? "subgraphs" : "streams";
		return (
			<>
				<ToolCallIndicator
					toolName={toolName}
					state={state}
					input={part.input}
				/>
				<ActionCard
					action={input.action}
					targets={input.targets.map((t) => ({ id: t.id ?? t.name, name: t.name, reason: t.reason }))}
					onConfirm={async () => {
						await executeAction(toolName, input.action, input.targets);
						addToolOutput({
							toolCallId: part.toolCallId,
							output: { confirmed: true, message: `${input.targets.length} ${resourceType} ${input.action}d successfully` },
						});
					}}
					onCancel={() =>
						addToolOutput({
							toolCallId: part.toolCallId,
							output: { confirmed: false, message: "Action cancelled by user" },
						})
					}
				/>
			</>
		);
	}

	// Output states — show indicator + result card (if applicable)
	if (state === "output-available") {
		const output = part.output as Record<string, unknown>;
		const indicator = (
			<ToolCallIndicator
				toolName={toolName}
				state={state}
				input={part.input}
				output={output}
			/>
		);

		const card = renderOutputCard(toolName, output);

		return (
			<>
				{indicator}
				{card}
			</>
		);
	}

	// Error state
	if (state === "output-error") {
		return (
			<>
				<ToolCallIndicator
					toolName={toolName}
					state={state}
					input={part.input}
				/>
				<div className="tool-error">
					Tool error: {(part as { errorText?: string }).errorText ?? "Unknown error"}
				</div>
			</>
		);
	}

	return null;
}

/** Render the visible card for a tool output, or null for invisible tools */
function renderOutputCard(toolName: string, output: Record<string, unknown>) {
	switch (toolName) {
		case "check_subgraphs":
			return (
				<SubgraphStatusCard
					subgraphs={output.subgraphs as Array<{
						name: string; status: string;
						lastProcessedBlock: number | null;
						totalProcessed: number; totalErrors: number;
					}>}
				/>
			);

		case "check_streams":
			return (
				<StreamStatusCard
					streams={output.streams as Array<{
						id: string; name: string; status: string;
						enabled: boolean; totalDeliveries: number;
						failedDeliveries: number; errorMessage: string | null;
					}>}
				/>
			);

		case "check_keys":
			return (
				<KeysCard
					keys={output.keys as Array<{
						id: string; name: string; prefix: string;
						status: string; lastUsedAt: string | null;
						createdAt: string;
					}>}
				/>
			);

		case "check_insights":
			return (
				<InsightsCard
					insights={output.insights as Array<{
						id: string; severity: "info" | "warning" | "danger";
						title: string; body: string; category: string;
					}>}
				/>
			);

		case "manage_streams":
		case "manage_keys":
		case "manage_subgraphs": {
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
				id: string; title: string | null;
				createdAt: string; summary: string;
			}>;
			return <MemoryRecallCard sessions={sessions} />;
		}

		// lookup_docs, diagnose, check_usage, query_subgraph
		// — invisible tools, indicator only
		default:
			return null;
	}
}

async function executeAction(
	toolName: string,
	action: string,
	targets: Array<{ id?: string; name: string }>,
) {
	const calls: Promise<Response>[] = [];

	for (const t of targets) {
		switch (toolName) {
			case "manage_streams": {
				const pathMap: Record<string, { method: string; path: string }> = {
					pause: { method: "POST", path: `/api/streams/${t.id}/pause` },
					resume: { method: "POST", path: `/api/streams/${t.id}/resume` },
					delete: { method: "DELETE", path: `/api/streams/${t.id}` },
					"replay-failed": { method: "POST", path: `/api/streams/${t.id}/replay-failed` },
				};
				const call = pathMap[action];
				if (call) calls.push(fetch(call.path, { method: call.method, credentials: "same-origin" }));
				break;
			}
			case "manage_keys": {
				if (action === "revoke") {
					calls.push(fetch(`/api/keys/${t.id}`, { method: "DELETE", credentials: "same-origin" }));
				}
				break;
			}
			case "manage_subgraphs": {
				const pathMap: Record<string, { method: string; path: string }> = {
					reindex: { method: "POST", path: `/api/subgraphs/${t.name}/reindex` },
					delete: { method: "DELETE", path: `/api/subgraphs/${t.name}` },
					stop: { method: "POST", path: `/api/subgraphs/${t.name}/stop` },
				};
				const call = pathMap[action];
				if (call) calls.push(fetch(call.path, { method: call.method, credentials: "same-origin" }));
				break;
			}
		}
	}

	await Promise.allSettled(calls);
}
