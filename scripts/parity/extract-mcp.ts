/**
 * Parity-audit extractor for the MCP server surface.
 *
 * Registers every group in `TOOL_GROUPS` (`packages/mcp/src/tool-groups.ts`, the
 * list `createServer()` loops over; one throwaway McpServer per group, so each
 * tool keeps its group),
 * then reads the SDK's tool/resource registries directly. No server is
 * started, no transport is connected, no network call is made — tool
 * handlers and resource read callbacks never run.
 *
 * Run from repo root: `bun scripts/parity/extract-mcp.ts`
 * Output: `scripts/parity/out/mcp.json`
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerResources } from "../../packages/mcp/src/resources.ts";
import { TOOL_GROUPS } from "../../packages/mcp/src/tool-groups.ts";

interface ParityItem {
	id: string;
	group: string;
	description: string;
	/** Present (true) only for deprecated pre-rename aliases kept callable. */
	alias?: boolean;
}

interface ParityResource {
	id: string;
	description: string;
}

interface ParitySurface {
	surface: "mcp";
	generatedFrom: string[];
	items: ParityItem[];
	resources: ParityResource[];
}

/** Internal registry shapes of @modelcontextprotocol/sdk McpServer (1.x). */
interface McpServerInternals {
	_registeredTools: Record<string, { description?: string }>;
	_registeredResources: Record<
		string,
		{ name: string; metadata?: { description?: string } }
	>;
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
	if (!s._registeredTools || !s._registeredResources) {
		throw new Error(
			"MCP SDK internals changed: _registeredTools/_registeredResources missing — update extract-mcp.ts",
		);
	}
	return s as McpServerInternals;
}

function freshServer(): McpServer {
	return new McpServer({ name: "parity-extract", version: "0.0.0" });
}

// defineTool registers deprecated aliases with this description prefix; use
// it to tag them so the parity audit can compare canonical names only.
const ALIAS_PREFIX = "Deprecated alias for `";

const items: ParityItem[] = [];
for (const { group, register } of TOOL_GROUPS) {
	const server = freshServer();
	register(server);
	for (const [name, tool] of Object.entries(
		internals(server)._registeredTools,
	)) {
		const description = tool.description ?? "";
		items.push({
			id: name,
			group,
			description,
			...(description.startsWith(ALIAS_PREFIX) ? { alias: true } : {}),
		});
	}
}

const duplicates = items
	.map((item) => item.id)
	.filter((id, i, ids) => ids.indexOf(id) !== i);
if (duplicates.length > 0) {
	throw new Error(`duplicate tool ids: ${duplicates.join(", ")}`);
}

const resourceServer = freshServer();
registerResources(resourceServer);
const resourceInternals = internals(resourceServer);
const resources: ParityResource[] = Object.entries(
	resourceInternals._registeredResources,
).map(([uri, resource]) => ({
	id: uri,
	description: resource.metadata?.description ?? "",
}));
// A resource template is one resource family (`secondlayer://samples/{id}`);
// list it by its URI template so docs mentions match it like any other URI.
for (const template of Object.values(
	resourceInternals._registeredResourceTemplates,
)) {
	resources.push({
		id: template.resourceTemplate.uriTemplate.toString(),
		description: template.metadata?.description ?? "",
	});
}

const surface: ParitySurface = {
	surface: "mcp",
	generatedFrom: [
		"packages/mcp/src/tool-groups.ts",
		"packages/mcp/src/resources.ts",
	],
	items,
	resources,
};

const outDir = join(dirname(fileURLToPath(import.meta.url)), "out");
await mkdir(outDir, { recursive: true });
const gitignore = Bun.file(join(outDir, ".gitignore"));
if (!(await gitignore.exists())) {
	await Bun.write(gitignore, "*.json\n");
}
await Bun.write(
	join(outDir, "mcp.json"),
	`${JSON.stringify(surface, null, "\t")}\n`,
);

const groups = new Set(items.map((item) => item.group));
const aliasCount = items.filter((item) => item.alias).length;
console.log(
	`mcp surface: ${items.length} tools across ${groups.size} groups (${aliasCount} deprecated aliases), ${resources.length} resources → scripts/parity/out/mcp.json`,
);
