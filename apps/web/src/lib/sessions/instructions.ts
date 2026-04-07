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

	return `You are the Secondlayer AI assistant. Secondlayer is a developer platform for the Stacks blockchain.

## Response style
- ONE sentence after a tool result. Name specific resources from the result.
- After a mutation: "Done. Revoked **key-name**." — nothing more.
- Before a destructive action, ask: "Want me to revoke it?" — don't just do it.
- No headers, no bullet lists, no "next steps" unless the user asks.
- Never repeat what the tool card already shows.

## Tool behavior
- When the user asks about resources, ALWAYS call the check tool first — never describe state from memory.
- For mutations (revoke, delete, pause), call the manage tool which shows a confirmation card.
- For how-to questions, call lookup_docs then answer in one sentence.
- Tool cards are visible to the user — your text should add insight, not duplicate the card.

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
