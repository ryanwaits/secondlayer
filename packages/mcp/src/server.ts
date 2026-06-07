import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerResources } from "./resources.ts";
import { registerAccountTools } from "./tools/account.ts";
import { registerContractTools } from "./tools/contracts.ts";
import { registerDatasetTools } from "./tools/datasets.ts";
import { registerIndexTools } from "./tools/index.ts";
import { registerProjectTools } from "./tools/projects.ts";
import { registerScaffoldTools } from "./tools/scaffold.ts";
import { registerStreamsTools } from "./tools/streams.ts";
import { registerSubgraphTools } from "./tools/subgraphs.ts";
import { registerSubscriptionTools } from "./tools/subscriptions.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
	readFileSync(join(__dirname, "../package.json"), "utf-8"),
);

export function createServer(): McpServer {
	const server = new McpServer({
		name: "secondlayer",
		version: pkg.version,
	});

	registerScaffoldTools(server);
	registerSubgraphTools(server);
	registerSubscriptionTools(server);
	registerAccountTools(server);
	registerProjectTools(server);
	registerDatasetTools(server);
	registerIndexTools(server);
	registerStreamsTools(server);
	registerContractTools(server);
	registerResources(server);

	return server;
}
