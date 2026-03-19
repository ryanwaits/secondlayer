import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTemplateTools } from "./tools/templates.ts";
import { registerScaffoldTools } from "./tools/scaffold.ts";
import { registerStreamTools } from "./tools/streams.ts";
import { registerSubgraphTools } from "./tools/subgraphs.ts";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "secondlayer",
    version: "0.2.1",
  });

  registerTemplateTools(server);
  registerScaffoldTools(server);
  registerStreamTools(server);
  registerSubgraphTools(server);

  return server;
}
