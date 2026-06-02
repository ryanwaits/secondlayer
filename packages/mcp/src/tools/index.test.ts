import { describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerIndexTools } from "./index.ts";

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

describe("index MCP tools", () => {
	it("registers the four SDK index surfaces and passes params through", async () => {
		const tools: RegisteredTool[] = [];
		const calls: Record<string, unknown> = {};
		const surface = (key: string) => ({
			list: async (params: unknown) => {
				calls[key] = params;
				return { events: [], next_cursor: null };
			},
		});
		const client = {
			index: {
				ftTransfers: surface("ft"),
				nftTransfers: surface("nft"),
				events: surface("events"),
				contractCalls: surface("calls"),
			},
		};
		registerIndexTools(
			fakeServer(tools),
			() =>
				client as unknown as ReturnType<
					typeof import("../lib/client.ts").getClient
				>,
		);

		expect(tools.map((t) => t.name).sort()).toEqual([
			"index_contract_calls",
			"index_events",
			"index_ft_transfers",
			"index_nft_transfers",
		]);

		await tools
			.find((t) => t.name === "index_ft_transfers")
			?.handler({ sender: "SP1", limit: 5 });
		expect(calls.ft).toEqual({ sender: "SP1", limit: 5 });

		await tools
			.find((t) => t.name === "index_events")
			?.handler({ eventType: "print", contractId: "SP1.x" });
		expect(calls.events).toEqual({ eventType: "print", contractId: "SP1.x" });
	});
});
