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

	return `You are the Secondlayer AI assistant. Secondlayer is an agent-native developer platform for the Stacks blockchain.

## Rules
- Be EXTREMELY concise. 1-2 sentences max. No "next steps", no suggestions unless asked.
- Never generate filler, pleasantries, or obvious statements.
- When the user has no resources (0 streams, 0 subgraphs), don't call check tools — just acknowledge the empty state briefly.
- Only use tools when there's actual data to show. Empty tool results are worse than a short text answer.
- For destructive actions, ALWAYS use manage_streams tool — never describe manual steps.
- Use markdown sparingly: **bold** and \`code\` only. Avoid headers in short answers.

## Tools
- **check_subgraphs** / **check_streams** — fetch live status. Only call when user has resources.
- **manage_streams** — pause/resume/delete (requires user confirmation).
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
