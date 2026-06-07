import { describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerScaffoldTools } from "./scaffold.ts";

interface RegisteredTool {
	name: string;
	handler: (args: Record<string, unknown>) => Promise<{
		content: Array<{ type: "text"; text: string }>;
		isError?: boolean;
	}>;
}

function fakeServer(tools: RegisteredTool[]): McpServer {
	return {
		tool: (
			name: string,
			_description: string,
			_schema: Record<string, unknown>,
			handler: RegisteredTool["handler"],
		) => {
			tools.push({ name, handler });
		},
	} as unknown as McpServer;
}

describe("scaffold MCP tools", () => {
	it("registers scaffold_from_trait and generates trait-scoped source", async () => {
		const tools: RegisteredTool[] = [];
		registerScaffoldTools(fakeServer(tools));

		expect(tools.map((t) => t.name)).toContain("scaffold_from_trait");

		const res = await tools
			.find((t) => t.name === "scaffold_from_trait")
			?.handler({ trait: "sip-010" });
		expect(res?.isError).toBeUndefined();
		expect(res?.content[0]?.text).toContain("type: 'ft_transfer'");
		expect(res?.content[0]?.text).toContain("trait: 'sip-010'");
		expect(res?.content[0]?.text).toContain("defineSubgraph(");
	});
});
