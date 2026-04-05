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
	check_usage: "Fetching usage stats...",
	check_keys: "Listing API keys...",
	check_insights: "Checking insights...",
	query_subgraph: "Querying subgraph data...",
	manage_streams: "Preparing action...",
	manage_keys: "Preparing key action...",
	manage_subgraphs: "Preparing subgraph action...",
	scaffold_subgraph: "Generating code...",
	lookup_docs: "Looking up docs...",
	diagnose: "Diagnosing...",
	recall_sessions: "Searching past sessions...",
};

const HUMAN_IN_LOOP_TOOLS = new Set([
	"manage_streams",
	"manage_keys",
	"manage_subgraphs",
]);

export function ToolPartRenderer({ part, addToolOutput }: ToolPartRendererProps) {
	const toolName = getToolName(part);
	const state = part.state;

	// Loading states for tools with execute
	if (state === "input-streaming") {
		return <ThinkingIndicator label={TOOL_LABELS[toolName] ?? "Working..."} />;
	}

	if (state === "input-available" && !HUMAN_IN_LOOP_TOOLS.has(toolName)) {
		return <ThinkingIndicator label={TOOL_LABELS[toolName] ?? "Working..."} />;
	}

	// Human-in-the-loop tools
	if (state === "input-available" && HUMAN_IN_LOOP_TOOLS.has(toolName)) {
		const input = part.input as {
			action: string;
			targets: Array<{ id?: string; name: string; reason?: string }>;
		};
		const resourceType = toolName === "manage_keys" ? "keys" : toolName === "manage_subgraphs" ? "subgraphs" : "streams";
		return (
			<ActionCard
				action={input.action}
				targets={input.targets.map((t) => ({ id: t.id ?? t.name, name: t.name, reason: t.reason }))}
				onConfirm={async () => {
					// Execute the actual API calls
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

			case "check_keys":
				return (
					<KeysCard
						keys={
							output.keys as Array<{
								id: string;
								name: string;
								prefix: string;
								status: string;
								lastUsedAt: string | null;
								createdAt: string;
							}>
						}
					/>
				);

			case "check_insights":
				return (
					<InsightsCard
						insights={
							output.insights as Array<{
								id: string;
								severity: "info" | "warning" | "danger";
								title: string;
								body: string;
								category: string;
							}>
						}
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
					id: string;
					title: string | null;
					createdAt: string;
					summary: string;
				}>;
				return <MemoryRecallCard sessions={sessions} />;
			}

			// check_usage, query_subgraph, lookup_docs, diagnose
			// render as text via the model's response — no dedicated card
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

/** Execute the actual API call for human-in-the-loop tools */
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
				if (call) {
					calls.push(fetch(call.path, { method: call.method, credentials: "same-origin" }));
				}
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
				if (call) {
					calls.push(fetch(call.path, { method: call.method, credentials: "same-origin" }));
				}
				break;
			}
		}
	}

	await Promise.allSettled(calls);
}
