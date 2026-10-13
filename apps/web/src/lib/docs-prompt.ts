import { AGENT_SETUP } from "@/lib/agent-prompts";

/** The "## Notes for agents" section body of a page's markdown, if it has one. */
function agentNotes(pageMd: string): string | null {
	const match = /^## Notes for agents\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(
		pageMd,
	);
	const body = match?.[1].trim();
	return body ? body : null;
}

/**
 * The text `/prompt` puts on the clipboard: setup, what to read, the rules the
 * page gives agents, then the task. Pure; the field supplies the page's
 * markdown and URL.
 */
export function buildPrompt({
	task,
	pageMd,
	pageUrl,
	extraUrls = [],
}: {
	task: string;
	pageMd: string;
	pageUrl: string;
	extraUrls?: string[];
}): string {
	const urls = [...new Set([pageUrl, ...extraUrls])];
	const notes = agentNotes(pageMd);
	return [
		AGENT_SETUP,
		`Read first:\n${urls.map((u) => `- ${u}`).join("\n")}`,
		notes ? `Rules from these docs:\n${notes}` : null,
		`Task: ${task.trim()}`,
	]
		.filter(Boolean)
		.join("\n\n");
}
