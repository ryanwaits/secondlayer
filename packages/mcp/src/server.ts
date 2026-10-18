import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveBaseUrl } from "@secondlayer/sdk";
import { isHostedArchiveUrl } from "./lib/hosted.ts";
import { restrictTools } from "./lib/tool.ts";
import { registerResources } from "./resources.ts";
import {
	ENV_TOOL_DEPS,
	TOOL_GROUPS,
	type ToolDeps,
	isHostedTool,
} from "./tool-groups.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
	readFileSync(join(__dirname, "../package.json"), "utf-8"),
);

export type { ToolDeps } from "./tool-groups.ts";

export interface CreateServerOptions extends Partial<ToolDeps> {
	/**
	 * The hosted MCP endpoint's server: only the tools each group marks
	 * `hosted`, with credentials from the options rather than the environment.
	 * Omitted, the server is the stdio/self-host one, reading env as always.
	 */
	hosted?: boolean;
}

export function createServer(options: CreateServerOptions = {}): McpServer {
	const server = new McpServer({
		name: "secondlayer",
		version: pkg.version,
	});
	const deps: ToolDeps = {
		clientProvider: options.clientProvider ?? ENV_TOOL_DEPS.clientProvider,
		archiveOpsClientProvider:
			options.archiveOpsClientProvider ??
			ENV_TOOL_DEPS.archiveOpsClientProvider,
		apiRequest: options.apiRequest ?? ENV_TOOL_DEPS.apiRequest,
	};

	if (options.hosted) {
		for (const group of TOOL_GROUPS) {
			if (group.hosted === false) continue;
			restrictTools(server, (name) => isHostedTool(group, name));
			group.register(server, deps);
		}
		restrictTools(server, () => false);
		registerResources(server, {
			clientProvider: deps.clientProvider,
			hosted: true,
		});
		return server;
	}

	const hostedApi = isHostedArchiveUrl(resolveBaseUrl());
	for (const { register, hostedOnly } of TOOL_GROUPS) {
		if (hostedOnly && !hostedApi) continue;
		register(server, deps);
	}
	registerResources(server, { clientProvider: deps.clientProvider });

	return server;
}
