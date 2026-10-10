import registry from "@/generated/mcp-tools.json";

/**
 * The MCP tool list, read from the generated registry snapshot
 * (packages/mcp/scripts/sync-tools.ts) so the page can't list a tool that
 * doesn't ship or miss one that does. Both the rendered tables and the
 * markdown twin (/docs/mcp.md) come from here.
 */

export type McpTool = {
	name: string;
	group: string;
	description: string;
	hostedOnly?: boolean;
};

/** Reader-facing heading per registry group. A group not listed here still
 *  renders, under its capitalized id, so a new group never drops off the page. */
const GROUP_TITLES: Record<string, string> = {
	scaffold: "Scaffold",
	subgraphs: "Subgraphs",
	webhooks: "Webhooks",
	index: "Index",
	streams: "Streams",
	contracts: "Contracts",
	codegen: "Codegen",
	instance: "Instance",
	archive: "Archive",
	setup: "Setup",
	account: "Account",
};

export const groupTitle = (group: string) =>
	GROUP_TITLES[group] ?? group.charAt(0).toUpperCase() + group.slice(1);

/** First sentence of a description: enough for a table row. The full text
 *  stays in the tool schema the client already receives. */
export function firstSentence(description: string): string {
	const text = description.replace(/\s+/g, " ").trim();
	for (const stop of text.matchAll(/[.!?](?=\s|$)/g)) {
		const head = text.slice(0, stop.index);
		// "(e.g. ...", "(incl. ..." end a clause, not the sentence.
		if (!/\b(?:e\.g|i\.e|incl|etc|vs)$/.test(head)) {
			return text.slice(0, stop.index + 1);
		}
	}
	return text;
}

export type ToolGroupView = {
	group: string;
	title: string;
	tools: McpTool[];
};

/** Tools grouped in registry order. */
export function toolGroups(): ToolGroupView[] {
	const groups = new Map<string, McpTool[]>();
	for (const tool of registry.tools as McpTool[]) {
		const list = groups.get(tool.group) ?? [];
		list.push(tool);
		groups.set(tool.group, list);
	}
	return [...groups].map(([group, tools]) => ({
		group,
		title: groupTitle(group),
		tools,
	}));
}

/** Resources and resource templates as one list of [uri, description]. */
export function resourceRows(): Array<{ uri: string; description: string }> {
	return [
		...registry.resources,
		...registry.resourceTemplates.map((t) => ({
			uri: t.uriTemplate,
			description: t.description,
		})),
	];
}

/** Table cell text: a pipe in a description would split the row. */
const cell = (text: string) => text.replace(/\|/g, "\\|");

/** The same tables as markdown, for /docs/mcp.md and llms-full.txt, where
 *  the rendered components are stripped. */
export function mcpResourcesMarkdown(): string {
	const lines = ["| Resource | What it returns |", "| --- | --- |"];
	for (const { uri, description } of resourceRows()) {
		lines.push(`| \`${uri}\` | ${cell(firstSentence(description))} |`);
	}
	return lines.join("\n");
}

export function mcpToolsMarkdown(): string {
	const lines: string[] = [];
	for (const { title, tools } of toolGroups()) {
		lines.push(`### ${title}`, "", "| Tool | What it does |", "| --- | --- |");
		for (const tool of tools) {
			const note = tool.hostedOnly ? " Hosted only." : "";
			lines.push(
				`| \`${tool.name}\` | ${cell(firstSentence(tool.description))}${note} |`,
			);
		}
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}
