import { formatSummaryForPrompt, type SessionSummary } from "./summary";
import type { AccountResources } from "./tools";

interface RecentSessionInfo {
	title: string | null;
	summary: unknown;
	created_at: string;
}

export function buildSessionInstructions(
	resources: AccountResources,
	recentSessions?: RecentSessionInfo[],
): string {
	const { streams, subgraphs, keys, chainTip } = resources;

	const streamList = streams.length
		? streams
				.map(
					(s) =>
						`- id:${s.id} name:"${s.name}" status:${s.status} enabled:${s.enabled} failed:${s.failedDeliveries}/${s.totalDeliveries}${s.errorMessage ? ` error:"${s.errorMessage}"` : ""}`,
				)
				.join("\n")
		: "No streams.";

	const subgraphList = subgraphs.length
		? subgraphs
				.map(
					(s) =>
						`- name:"${s.name}" status:${s.status} block:${s.lastProcessedBlock ?? "n/a"} errors:${s.totalErrors}`,
				)
				.join("\n")
		: "No subgraphs.";

	const keyList = keys.length
		? keys
				.map((k) => `- id:${k.id} prefix:${k.prefix} name:"${k.name}"`)
				.join("\n")
		: "No API keys.";

	return `You are the Secondlayer AI assistant in a persistent chat session.
Secondlayer is an agent-native developer platform for the Stacks blockchain.

## Tool usage
- Use **check_subgraphs** / **check_streams** to fetch live resource status when asked about health or state.
- Use **manage_streams** for pause/resume/delete/replay (requires user confirmation — never skip this).
- Use **scaffold_subgraph** to generate subgraph code from a contract.
- Use **lookup_docs** before answering product questions.
- Use **diagnose** to analyze resource health in detail.
- Use **recall_sessions** when the user references past conversations or asks what was done previously.
- For destructive actions, ALWAYS use manage_streams — never describe manual steps.
- Use tools proactively when the user asks about resource state.

## Behavior
- Be concise. No filler.
- Use markdown: **bold**, \`code\`, bullets, headers.
- Reference specific resources by name.
- When showing resource status, prefer using the check tools so the UI renders interactive cards.

## User's current resources

### Streams
${streamList}

### Subgraphs
${subgraphList}

### API Keys
${keyList}

${chainTip != null ? `### Chain tip\nBlock ${chainTip.toLocaleString()}` : ""}
${buildRecentSessionsSection(recentSessions)}`;
}

function buildRecentSessionsSection(
	sessions?: RecentSessionInfo[],
): string {
	if (!sessions?.length) return "";

	const lines = sessions.map((s) => {
		const date = new Date(s.created_at).toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
		});
		const title = s.title || "Untitled";
		const summary = s.summary
			? formatSummaryForPrompt(s.summary as SessionSummary)
			: "general conversation";
		return `- "${title}" (${date}): ${summary}`;
	});

	return `
## Recent sessions
${lines.join("\n")}
Use recall_sessions tool for detailed history if the user asks.`;
}
