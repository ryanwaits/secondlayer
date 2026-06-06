import { describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSubgraphTools } from "./subgraphs.ts";

interface RegisteredTool {
	name: string;
	schema: Record<string, unknown>;
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
			schema: Record<string, unknown>,
			handler: RegisteredTool["handler"],
		) => {
			tools.push({ name, schema, handler });
		},
	} as unknown as McpServer;
}

describe("subgraph MCP tools", () => {
	it("registers subgraphs_deploy startBlock input", () => {
		const tools: RegisteredTool[] = [];
		registerSubgraphTools(fakeServer(tools), () => ({}) as never);

		const deploy = tools.find((tool) => tool.name === "subgraphs_deploy");
		expect(deploy).toBeDefined();
		const startBlock = deploy?.schema.startBlock as {
			safeParse: (value: unknown) => { success: boolean };
		};
		expect(startBlock.safeParse(0).success).toBe(true);
		expect(startBlock.safeParse(123).success).toBe(true);
		expect(startBlock.safeParse(-1).success).toBe(false);
		expect(startBlock.safeParse(1.5).success).toBe(false);
	});

	it("subgraphs_codegen generates an ORM schema from code", async () => {
		const tools: RegisteredTool[] = [];
		registerSubgraphTools(fakeServer(tools), () => ({}) as never);
		const codegen = tools.find((tool) => tool.name === "subgraphs_codegen");
		expect(codegen).toBeDefined();
		if (!codegen) throw new Error("subgraphs_codegen not registered");

		const code = `import { defineSubgraph } from "@secondlayer/subgraphs";
export default defineSubgraph({
  name: "dex",
  sources: { calls: { type: "contract_call", contractId: "SP.dex" } },
  schema: { swaps: { columns: { amount: { type: "uint" } } } },
  handlers: { calls: async () => {} },
});`;
		const result = await codegen.handler({ code, target: "kysely" });
		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toContain("export interface DB");
		expect(result.content[0]?.text).toContain("amount: string;");
	});

	it("subgraphs_codegen rejects code+name together", async () => {
		const tools: RegisteredTool[] = [];
		registerSubgraphTools(fakeServer(tools), () => ({}) as never);
		const codegen = tools.find((tool) => tool.name === "subgraphs_codegen");
		const result = await codegen?.handler({ code: "x", name: "y" });
		expect(result?.isError).toBe(true);
		expect(result?.content[0]?.text).toContain("exactly one");
	});

	it("registers subgraphs_spec with agent default format", async () => {
		const tools: RegisteredTool[] = [];
		registerSubgraphTools(
			fakeServer(tools),
			() =>
				({
					subgraphs: {
						schema: async () => ({ name: "test-subgraph" }),
					},
				}) as never,
		);

		const spec = tools.find((tool) => tool.name === "subgraphs_spec");
		expect(spec).toBeDefined();
		if (!spec) throw new Error("subgraphs_spec tool not registered");
		const result = await spec.handler({ name: "test-subgraph" });
		expect(result.content[0]?.text).toContain("test-subgraph");
	});
});
