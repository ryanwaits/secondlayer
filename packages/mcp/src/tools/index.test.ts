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
	it("registers the index tools and passes params through", async () => {
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
			"index_block",
			"index_blocks",
			"index_canonical",
			"index_contract_calls",
			"index_events",
			"index_ft_transfers",
			"index_mempool",
			"index_mempool_tx",
			"index_nft_transfers",
			"index_stacking",
			"index_transaction",
			"index_transactions",
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

	it("coerces numeric refs and surfaces a null get as not_found", async () => {
		const tools: RegisteredTool[] = [];
		let getRef: unknown;
		const client = {
			index: {
				blocks: {
					get: async (ref: unknown) => {
						getRef = ref;
						return null;
					},
				},
			},
		};
		registerIndexTools(
			fakeServer(tools),
			() =>
				client as unknown as ReturnType<
					typeof import("../lib/client.ts").getClient
				>,
		);

		const res = await tools
			.find((t) => t.name === "index_block")
			?.handler({ ref: "12345" });
		expect(getRef).toBe(12345); // digit string → number (height lookup)
		expect(res?.isError).toBe(true);
		expect(res?.content[0]?.text).toContain("not_found");

		await tools
			.find((t) => t.name === "index_block")
			?.handler({ ref: "0xabc" });
		expect(getRef).toBe("0xabc"); // hash stays a string
	});
});
