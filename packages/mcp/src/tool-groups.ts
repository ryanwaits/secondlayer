import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SecondLayer } from "@secondlayer/sdk";
import {
	type ApiRequest,
	apiRequest,
	getArchiveOpsClient,
	getClient,
} from "./lib/client.ts";
import { registerAccountTools } from "./tools/account.ts";
import { registerArchiveCliTools } from "./tools/archive-cli.ts";
import { registerArchiveTools } from "./tools/archive.ts";
import { registerCodegenTools } from "./tools/codegen.ts";
import { registerContractTools } from "./tools/contracts.ts";
import { registerIndexTools } from "./tools/index.ts";
import { registerInstanceTools } from "./tools/instance.ts";
import { registerScaffoldTools } from "./tools/scaffold.ts";
import { registerStreamsTools } from "./tools/streams.ts";
import { registerSubgraphTools } from "./tools/subgraphs.ts";
import { registerWebhookTools } from "./tools/webhooks.ts";

/** Where tools get their credentials. Omitted, each reads the environment
 *  (the stdio and self-host servers). */
export interface ToolDeps {
	clientProvider: () => SecondLayer;
	archiveOpsClientProvider: () => SecondLayer;
	apiRequest: ApiRequest;
}

export const ENV_TOOL_DEPS: ToolDeps = {
	clientProvider: getClient,
	archiveOpsClientProvider: getArchiveOpsClient,
	apiRequest,
};

export interface ToolGroup {
	group: string;
	register: (server: McpServer, deps?: ToolDeps) => void;
	/** Registered only when the base URL is the hosted archive. */
	hostedOnly?: true;
	/**
	 * Served by the hosted MCP endpoint (`api.secondlayer.tools/mcp`): `true`
	 * for every tool in the group, `false` for none, or the exact tools that
	 * are. A hosted tool only calls the API and returns text: nothing that
	 * writes files, spawns a process, needs a self-host-only route, or mints a
	 * credential. Every group must choose.
	 */
	hosted: boolean | readonly string[];
}

/**
 * Every tool group, in registration order. The one list `createServer()`, the
 * docs tool table generator (scripts/sync-tools.ts) and the parity extractor
 * all read, so a new group cannot reach the server without reaching the docs.
 */
export const TOOL_GROUPS: readonly ToolGroup[] = [
	{
		group: "scaffold",
		register: (s, d = ENV_TOOL_DEPS) =>
			registerScaffoldTools(s, d.clientProvider),
		hosted: true,
	},
	{
		group: "subgraphs",
		register: (s, d = ENV_TOOL_DEPS) =>
			registerSubgraphTools(s, d.clientProvider),
		// Deploy/test write temp files, and hosted runs no subgraphs.
		hosted: false,
	},
	{
		group: "webhooks",
		register: (s, d = ENV_TOOL_DEPS) =>
			registerWebhookTools(s, d.clientProvider),
		// Webhook routes are self-host only on this API.
		hosted: false,
	},
	{
		group: "index",
		register: (s, d = ENV_TOOL_DEPS) => registerIndexTools(s, d.clientProvider),
		hosted: true,
	},
	{
		group: "streams",
		register: (s, d = ENV_TOOL_DEPS) =>
			registerStreamsTools(s, d.clientProvider),
		hosted: true,
	},
	{
		group: "contracts",
		register: (s, d = ENV_TOOL_DEPS) =>
			registerContractTools(s, d.clientProvider),
		hosted: true,
	},
	{ group: "codegen", register: (s) => registerCodegenTools(s), hosted: false },
	{
		group: "instance",
		register: (s, d = ENV_TOOL_DEPS) =>
			registerInstanceTools(s, d.clientProvider),
		// Self-host diagnosis.
		hosted: false,
	},
	{
		group: "archive",
		register: (s, d = ENV_TOOL_DEPS) =>
			registerArchiveTools(s, d.clientProvider, d.archiveOpsClientProvider),
		hosted: false,
	},
	{
		group: "archive",
		// Spawns the local CLI.
		register: (s) => registerArchiveCliTools(s),
		hosted: false,
	},
	{
		group: "account",
		register: (s, d = ENV_TOOL_DEPS) => registerAccountTools(s, d.apiRequest),
		hostedOnly: true,
		// Never `account_create_key`: an app must not mint a durable key.
		hosted: ["account_whoami"],
	},
];

/** Whether the hosted MCP endpoint serves `tool` from `group`. */
export function isHostedTool(group: ToolGroup, tool: string): boolean {
	return (
		group.hosted === true ||
		(Array.isArray(group.hosted) && group.hosted.includes(tool))
	);
}
