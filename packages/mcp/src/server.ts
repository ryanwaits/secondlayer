import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveBaseUrl } from "@secondlayer/sdk";
import { isHostedArchiveUrl } from "./lib/hosted.ts";
import { registerResources } from "./resources.ts";
import { TOOL_GROUPS } from "./tool-groups.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
	readFileSync(join(__dirname, "../package.json"), "utf-8"),
);

export function createServer(): McpServer {
	const server = new McpServer({
		name: "secondlayer",
		version: pkg.version,
	});

	const hosted = isHostedArchiveUrl(resolveBaseUrl());
	for (const { register, hostedOnly } of TOOL_GROUPS) {
		if (hostedOnly && !hosted) continue;
		register(server);
	}
	registerResources(server);

	return server;
}
