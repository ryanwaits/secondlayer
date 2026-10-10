import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAccountTools } from "./tools/account.ts";
import { registerArchiveTools } from "./tools/archive.ts";
import { registerCodegenTools } from "./tools/codegen.ts";
import { registerContractTools } from "./tools/contracts.ts";
import { registerIndexTools } from "./tools/index.ts";
import { registerInstanceTools } from "./tools/instance.ts";
import { registerScaffoldTools } from "./tools/scaffold.ts";
import { registerSetupTools } from "./tools/setup.ts";
import { registerStreamsTools } from "./tools/streams.ts";
import { registerSubgraphTools } from "./tools/subgraphs.ts";
import { registerWebhookTools } from "./tools/webhooks.ts";

export interface ToolGroup {
	group: string;
	register: (server: McpServer) => void;
	/** Registered only when the base URL is the hosted archive. */
	hostedOnly?: true;
}

/**
 * Every tool group, in registration order. The one list `createServer()`, the
 * docs tool table generator (scripts/sync-tools.ts) and the parity extractor
 * all read, so a new group cannot reach the server without reaching the docs.
 */
export const TOOL_GROUPS: readonly ToolGroup[] = [
	{ group: "scaffold", register: registerScaffoldTools },
	{ group: "subgraphs", register: registerSubgraphTools },
	{ group: "webhooks", register: registerWebhookTools },
	{ group: "index", register: registerIndexTools },
	{ group: "streams", register: registerStreamsTools },
	{ group: "contracts", register: registerContractTools },
	{ group: "codegen", register: registerCodegenTools },
	{ group: "instance", register: registerInstanceTools },
	{ group: "archive", register: registerArchiveTools },
	{ group: "setup", register: registerSetupTools },
	{ group: "account", register: registerAccountTools, hostedOnly: true },
];
