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
	it("registers only scaffold_from_contract and generates source from the registry ABI", async () => {
		const tools: RegisteredTool[] = [];
		const client = {
			contracts: {
				get: async () => ({
					contract_id: "SP1.dex",
					abi_status: "ok",
					abi: {
						functions: [
							{
								name: "swap",
								access: "public",
								args: [{ name: "amount", type: "uint128" }],
								outputs: {
									type: { response: { ok: "bool", error: "uint128" } },
								},
							},
						],
						maps: [],
					},
				}),
			},
		};
		registerScaffoldTools(
			fakeServer(tools),
			() =>
				client as unknown as ReturnType<
					typeof import("../lib/client.ts").getClient
				>,
		);

		expect(tools.map((t) => t.name)).toEqual(["scaffold_from_contract"]);

		const res = await tools
			.find((t) => t.name === "scaffold_from_contract")
			?.handler({ contractId: "SP1.dex" });
		expect(res?.isError).toBeUndefined();
		expect(res?.content[0]?.text).toContain("defineSubgraph(");
		expect(res?.content[0]?.text).toContain("SP1.dex");
	});
});
