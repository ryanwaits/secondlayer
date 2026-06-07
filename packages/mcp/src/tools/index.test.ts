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
		let discovered = false;
		const client = {
			index: {
				ftTransfers: surface("ft"),
				nftTransfers: surface("nft"),
				events: surface("events"),
				contractCalls: surface("calls"),
				discover: async () => {
					discovered = true;
					return { event_type_filters: { ft_transfer: {} } };
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

		expect(tools.map((t) => t.name).sort()).toEqual([
			"index_block",
			"index_blocks",
			"index_canonical",
			"index_codegen",
			"index_contract_calls",
			"index_discover",
			"index_events",
			"index_ft_transfers",
			"index_mempool",
			"index_mempool_tx",
			"index_nft_transfers",
			"index_stacking",
			"index_transaction",
			"index_transaction_proof",
			"index_transactions",
			"index_usage",
		]);

		await tools
			.find((t) => t.name === "index_ft_transfers")
			?.handler({ sender: "SP1", limit: 5 });
		expect(calls.ft).toEqual({ sender: "SP1", limit: 5 });

		// trait flows through the working paths (events + contract-calls)
		await tools
			.find((t) => t.name === "index_events")
			?.handler({ eventType: "ft_transfer", trait: "sip-010" });
		expect(calls.events).toEqual({
			eventType: "ft_transfer",
			trait: "sip-010",
		});

		await tools
			.find((t) => t.name === "index_contract_calls")
			?.handler({ trait: "sip-010" });
		expect(calls.calls).toEqual({ trait: "sip-010" });

		const disc = await tools
			.find((t) => t.name === "index_discover")
			?.handler({});
		expect(discovered).toBe(true);
		expect(disc?.content[0]?.text).toContain("event_type_filters");
	});

	it("index_transaction_proof delegates to getProof; null → not_found", async () => {
		const tools: RegisteredTool[] = [];
		let proofTx: string | undefined;
		const client = {
			index: {
				transactions: {
					getProof: async (txId: string) => {
						proofTx = txId;
						return txId === "0xhit"
							? { raw_tx: "00", tx_merkle_path: [] }
							: null;
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
		const tool = tools.find((t) => t.name === "index_transaction_proof");
		const hit = await tool?.handler({ txId: "0xhit" });
		expect(proofTx).toBe("0xhit");
		expect(hit?.isError).toBeUndefined();
		expect(hit?.content[0]?.text).toContain("tx_merkle_path");
		const miss = await tool?.handler({ txId: "0xmiss" });
		expect(miss?.isError).toBe(true);
		expect(miss?.content[0]?.text).toContain("not_found");
	});

	it("index_codegen emits a typed Index schema without an API call", async () => {
		const tools: RegisteredTool[] = [];
		registerIndexTools(fakeServer(tools), () => ({}) as never);
		const res = await tools
			.find((t) => t.name === "index_codegen")
			?.handler({ target: "kysely", tables: ["blocks"] });
		expect(res?.isError).toBeUndefined();
		expect(res?.content[0]?.text).toContain("export interface Blocks {");
		expect(res?.content[0]?.text).toContain("height: number;");
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
