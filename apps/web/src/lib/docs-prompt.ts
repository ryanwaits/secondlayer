import { AGENT_SETUP } from "@/lib/agent-prompts";
import type { KeyHint } from "@/lib/docs-account-summary";
import { SITE, markdownPath } from "@/lib/docs-agent";

const HOSTED_KEY_LINE = /^- Hosted\/archive:.*$/m;
const MAX_URLS = 12;

/**
 * The markdown twin an `@` chip points the agent at. Pages and headings use
 * the page's `.md`; an endpoint has its own `.md` under the reference.
 */
export function chipUrl(item: { href?: string; sub?: string }): string | null {
	if (!item.href) return null;
	const [path, anchor] = item.href.split("#");
	if (path.startsWith("/docs/api/") && item.sub === "endpoint" && anchor) {
		return `${SITE}/docs/api-reference/${anchor}.md`;
	}
	return `${SITE}${markdownPath(path)}${anchor ? `#${anchor}` : ""}`;
}

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
 * markdown and URL. `account` and `key` are signed-in only and carry names and
 * prefixes, never a full key or receiver URL.
 */
export function buildPrompt({
	task,
	pageMd,
	pageUrl,
	extraUrls = [],
	account,
	key,
}: {
	task: string;
	pageMd: string;
	pageUrl: string;
	extraUrls?: string[];
	/** `accountSummary()` lines. Omit when signed out. */
	account?: string;
	/** The key to name in setup. Omit when signed out. */
	key?: KeyHint | null;
}): string {
	const urls = [...new Set([pageUrl, ...extraUrls])].slice(0, MAX_URLS);
	const notes = agentNotes(pageMd);
	const setup = key
		? AGENT_SETUP.replace(
				HOSTED_KEY_LINE,
				() =>
					`- Key: your "${key.name}" key, \`${key.prefix}…\` (prefix shown; paste the full key from /account/keys)`,
			)
		: AGENT_SETUP;
	const accountBlock = account
		? `My account (use these names, not placeholders):\n${account
				.split("\n")
				.map((line) => `- ${line}`)
				.join("\n")}\n- Live state: the secondlayer MCP, with the key above`
		: null;
	return [
		setup,
		`Read first:\n${urls.map((u) => `- ${u}`).join("\n")}`,
		notes ? `Rules from these docs:\n${notes}` : null,
		accountBlock,
		`Task: ${task.trim()}`,
	]
		.filter(Boolean)
		.join("\n\n");
}
