import registry from "@/generated/mcp-tools.json";

export type McpTool = {
	name: string;
	group: string;
	description: string;
	hostedOnly?: boolean;
	remote?: boolean;
};

export function toolNote(tool: McpTool): string {
	if (tool.remote === false)
		return tool.hostedOnly
			? " Local only, against the hosted API."
			: " Local only.";
	return tool.hostedOnly ? " Hosted only." : "";
}

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
	account: "Account",
};

export const groupTitle = (group: string) =>
	GROUP_TITLES[group] ?? group.charAt(0).toUpperCase() + group.slice(1);

export function firstSentence(description: string): string {
	const text = description.replace(/\s+/g, " ").trim();
	for (const stop of text.matchAll(/[.!?](?=\s|$)/g)) {
		const head = text.slice(0, stop.index);
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

export function resourceRows(): Array<{ uri: string; description: string }> {
	return [
		...registry.resources,
		...registry.resourceTemplates.map((t) => ({
			uri: t.uriTemplate,
			description: t.description,
		})),
	];
}

const cell = (text: string) => text.replace(/\|/g, "\\|");

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
			lines.push(
				`| \`${tool.name}\` | ${cell(firstSentence(tool.description))}${toolNote(tool)} |`,
			);
		}
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}
