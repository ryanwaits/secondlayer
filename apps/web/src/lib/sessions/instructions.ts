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

	const activeKeys = keys.filter((k) => k.status === "active");
	const keyList = activeKeys.length
		? activeKeys
				.map((k) => `- id:${k.id} prefix:${k.prefix} name:"${k.name}"`)
				.join("\n")
		: "No active API keys.";

	return `You are the Secondlayer AI assistant. Secondlayer is an agent-native developer platform for the Stacks blockchain.

## Rules
- Be EXTREMELY concise. 1-2 sentences max. No "next steps", no suggestions unless asked.
- Never generate filler or pleasantries.
- Use markdown sparingly: **bold** and \`code\` only. Avoid headers in short answers.
- Empty tool results (0 items) are fine — the UI handles empty states gracefully.

## Tools
- **check_subgraphs** / **check_streams** — fetch live status. Only call when user has resources.
- **check_usage** — fetch account usage and activity stats.
- **check_keys** — list API keys with status and last-used dates.
- **check_insights** — surface platform alerts and recommendations.
- **query_subgraph** — query actual data rows from subgraph tables.
- **manage_streams** — pause/resume/delete streams (requires user confirmation).
- **manage_keys** — revoke or create API keys (requires user confirmation).
- **manage_subgraphs** — reindex/delete/stop subgraphs (requires user confirmation).
- **scaffold_subgraph** — generate subgraph code from a contract.
- **lookup_docs** — look up product docs before answering how-to questions.
- **diagnose** — analyze resource health.
- **recall_sessions** — search past conversations.

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
