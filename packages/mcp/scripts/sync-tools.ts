/**
 * Publishes the MCP tool registry to the docs site, which renders it on
 * /docs/mcp instead of listing tools by hand.
 *
 * Run from packages/mcp:  bun run tools
 *
 * Lives here rather than in apps/web for the same reason sync-openapi.ts lives
 * in the API: the package owns its description and hands it over, and the docs
 * site never imports @secondlayer/mcp (which pulls the SDK, bundler and
 * subgraph runtime into a static build).
 *
 * Each group registers into a throwaway McpServer, so nothing is started, no
 * transport connects, and no handler or resource read callback ever runs.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerResources } from "../src/resources.ts";
import { TOOL_GROUPS } from "../src/tool-groups.ts";

const OUT = join(
	import.meta.dir,
	"../../../apps/web/src/generated/mcp-tools.json",
);

/** Internal registry shapes of @modelcontextprotocol/sdk McpServer (1.x). */
interface McpServerInternals {
	_registeredTools: Record<string, { description?: string }>;
	_registeredResources: Record<string, { metadata?: { description?: string } }>;
	_registeredResourceTemplates: Record<
		string,
		{
			resourceTemplate: { uriTemplate: { toString(): string } };
			metadata?: { description?: string };
		}
	>;
}

function internals(server: McpServer): McpServerInternals {
	const s = server as unknown as Partial<McpServerInternals>;
	if (
		!s._registeredTools ||
		!s._registeredResources ||
		!s._registeredResourceTemplates
	) {
		throw new Error(
			"MCP SDK internals changed: _registeredTools/_registeredResources/_registeredResourceTemplates missing, update sync-tools.ts",
		);
	}
	return s as McpServerInternals;
}

const freshServer = () =>
	new McpServer({ name: "sync-tools", version: "0.0.0" });
const byKey =
	<T>(key: (item: T) => string) =>
	(a: T, b: T) =>
		key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;

// Deprecated pre-rename aliases stay callable but are not documented.
const ALIAS_PREFIX = "Deprecated alias for `";

type Tool = {
	name: string;
	group: string;
	description: string;
	hostedOnly?: true;
};
const tools: Tool[] = [];
for (const { group, register, hostedOnly } of TOOL_GROUPS) {
	const server = freshServer();
	register(server);
	const groupTools: Tool[] = [];
	for (const [name, tool] of Object.entries(
		internals(server)._registeredTools,
	)) {
		const description = tool.description ?? "";
		if (description.startsWith(ALIAS_PREFIX)) continue;
		groupTools.push({
			name,
			group,
			description,
			...(hostedOnly ? { hostedOnly } : {}),
		});
	}
	tools.push(...groupTools.sort(byKey((t) => t.name)));
}

const duplicates = tools
	.map((t) => t.name)
	.filter((name, i, names) => names.indexOf(name) !== i);
if (duplicates.length > 0) {
	throw new Error(`duplicate tool names: ${duplicates.join(", ")}`);
}

const resourceServer = freshServer();
registerResources(resourceServer);
const reg = internals(resourceServer);
const resources = Object.entries(reg._registeredResources)
	.map(([uri, r]) => ({ uri, description: r.metadata?.description ?? "" }))
	.sort(byKey((r) => r.uri));
const resourceTemplates = Object.values(reg._registeredResourceTemplates)
	.map((t) => ({
		uriTemplate: t.resourceTemplate.uriTemplate.toString(),
		description: t.metadata?.description ?? "",
	}))
	.sort(byKey((t) => t.uriTemplate));

await mkdir(dirname(OUT), { recursive: true });
await writeFile(
	OUT,
	`${JSON.stringify({ tools, resources, resourceTemplates }, null, "\t")}\n`,
);

console.log(
	`✓ apps/web/src/generated/mcp-tools.json — ${tools.length} tools, ${resources.length} resources, ${resourceTemplates.length} templates`,
);
