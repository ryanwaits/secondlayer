import { isToolUIPart, getToolName, type UIMessage } from "ai";

export interface SessionSummary {
	toolCalls: Array<{
		tool: string;
		action?: string;
		resources?: string[];
	}>;
	topics: string[];
}

/**
 * Extract a condensed summary of what happened in a session
 * from the message parts. Used for cross-session recall.
 */
export function extractSessionSummary(
	messages: UIMessage[],
): SessionSummary {
	const toolCalls: SessionSummary["toolCalls"] = [];
	const topicSet = new Set<string>();

	for (const msg of messages) {
		if (msg.role !== "assistant") continue;

		for (const part of msg.parts) {
			if (!isToolUIPart(part)) continue;
			if (part.state !== "output-available") continue;

			const toolName = getToolName(part);
			const output = part.output as Record<string, unknown> | undefined;

			switch (toolName) {
				case "check_subgraphs": {
					const subs = (output?.subgraphs as Array<{ name: string }>) ?? [];
					toolCalls.push({
						tool: "check_subgraphs",
						resources: subs.map((s) => s.name),
					});
					topicSet.add("subgraph-health");
					break;
				}
				case "check_streams": {
					const streams = (output?.streams as Array<{ name: string }>) ?? [];
					toolCalls.push({
						tool: "check_streams",
						resources: streams.map((s) => s.name),
					});
					topicSet.add("stream-health");
					break;
				}
				case "manage_streams": {
					const input = part.input as {
						action?: string;
						targets?: Array<{ name: string }>;
					} | undefined;
					toolCalls.push({
						tool: "manage_streams",
						action: input?.action,
						resources: input?.targets?.map((t) => t.name),
					});
					topicSet.add("stream-management");
					break;
				}
				case "scaffold_subgraph": {
					const contractId = (output as { contractId?: string })?.contractId;
					toolCalls.push({
						tool: "scaffold_subgraph",
						resources: contractId ? [contractId] : [],
					});
					topicSet.add("scaffolding");
					break;
				}
				case "recall_sessions": {
					topicSet.add("session-recall");
					break;
				}
				default: {
					toolCalls.push({ tool: toolName });
					break;
				}
			}
		}
	}

	return {
		toolCalls,
		topics: Array.from(topicSet),
	};
}

/** Format a summary into a human-readable string for system prompt injection */
export function formatSummaryForPrompt(summary: SessionSummary): string {
	if (summary.toolCalls.length === 0) return "General conversation";

	return summary.toolCalls
		.map((tc) => {
			const parts = [tc.tool.replace(/_/g, " ")];
			if (tc.action) parts.push(`(${tc.action})`);
			if (tc.resources?.length) parts.push(`on ${tc.resources.join(", ")}`);
			return parts.join(" ");
		})
		.join("; ");
}
