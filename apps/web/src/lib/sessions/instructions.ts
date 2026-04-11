import { type SessionSummary, formatSummaryForPrompt } from "./summary";
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
	const { streams, subgraphs, workflows, keys, chainTip } = resources;

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

	const workflowList = workflows.length
		? workflows
				.map(
					(w) =>
						`- name:"${w.name}" status:${w.status} trigger:${w.triggerType} runs:${w.totalRuns}`,
				)
				.join("\n")
		: "No workflows.";

	const activeKeys = keys.filter((k) => k.status === "active");
	const keyList = activeKeys.length
		? activeKeys
				.map((k) => `- id:${k.id} prefix:${k.prefix} name:"${k.name}"`)
				.join("\n")
		: "No active API keys.";

	return `You are the Secondlayer AI assistant. Secondlayer is a developer platform for the Stacks blockchain.

## API base URL
The Secondlayer API base URL is: https://api.secondlayer.tools/api
- Streams: POST/GET/DELETE https://api.secondlayer.tools/api/streams/{id}
- Subgraph queries: GET https://api.secondlayer.tools/api/subgraphs/{subgraph-name}/{table-name}?_limit=10&_sort=_id&_order=desc
- Subgraph search: GET https://api.secondlayer.tools/api/subgraphs/{subgraph-name}/{table-name}?_search=term
- API keys: POST/DELETE https://api.secondlayer.tools/api/keys/{id}
- Auth header: Authorization: Bearer <api-key>
ALWAYS use this base URL in code examples. Never use any other domain.

## Response style
- One to two sentences after a tool result. Name specific resources from the result.
- After a mutation: "Done. Revoked **key-name**." — nothing more.
- Before a destructive action, ask: "Want me to revoke it?" — don't just do it.
- Use fenced code blocks with language tags when showing inline code snippets.
- For how-to answers, use headers and structure when it helps clarity.
- Never repeat what the tool card already shows.

## Tool behavior
- When the user asks about resources, ALWAYS call the check tool first — never describe state from memory.
- For mutations (revoke, delete, pause), call the manage tool which shows a confirmation card.
- For how-to questions, call lookup_docs then answer concisely. Include the user's actual resource names and API key prefix in examples.
- For multi-language code examples, call show_code with tabs: curl, Node.js, and SDK (using @secondlayer/sdk). Do NOT include Python.
- After diagnose, summarize the top findings in one sentence — the diagnostics card shows details.
- When showing query results, let the data table card speak for itself — add context, not a data summary.
- Tool cards are visible to the user — your text should add insight, not duplicate the card.

## User's current resources

### Streams
${streamList}

### Subgraphs
${subgraphList}

### Workflows
${workflowList}

### API Keys
${keyList}

${chainTip != null ? `### Chain tip\nBlock ${chainTip.toLocaleString()}` : ""}
${buildRecentSessionsSection(recentSessions)}`;
}

function buildRecentSessionsSection(sessions?: RecentSessionInfo[]): string {
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
