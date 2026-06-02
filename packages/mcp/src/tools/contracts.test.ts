import { describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerContractTools } from "./contracts.ts";

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

describe("contracts MCP tool", () => {
	it("registers contracts_find and forwards params", async () => {
		const tools: RegisteredTool[] = [];
		let received: unknown = null;
		const client = {
			contracts: {
				list: async (params: unknown) => {
					received = params;
					return {
						contracts: [{ contract_id: "SP1.token" }],
						next_cursor: null,
					};
				},
			},
		};
		registerContractTools(
			fakeServer(tools),
			() =>
				client as unknown as ReturnType<
					typeof import("../lib/client.ts").getClient
				>,
		);

		expect(tools.map((t) => t.name)).toEqual(["contracts_find"]);
		const res = await tools[0]?.handler({
			trait: "sip-010",
			conformance: "inferred",
		});
		expect(received).toEqual({ trait: "sip-010", conformance: "inferred" });
		expect(res?.content[0]?.text).toContain("SP1.token");
	});
});
