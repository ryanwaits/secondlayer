import { describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerIndexTools } from "./index.ts";

interface RegisteredTool {
	name: string;
	/** The advertised input shape — what an agent can actually pass. Zod runs at
	 *  the MCP protocol boundary, not in the handler, so a filter missing here is
	 *  unreachable no matter what the handler forwards. */
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
				printSchema: async (contractId: string) => {
					calls.printSchema = contractId;
					return { contract_id: contractId, topics: [] };
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
			"batch_query",
			"index_blocks",
			"index_contract_calls",
			"index_discover",
			"index_events",
			"index_ft_transfers",
			"index_nft_transfers",
			"index_print_schema",
			"index_transactions",
		]);

		// The FT and NFT transfer tools wrap the same wire shape, so they must
		// advertise the same filters. Without assetIdentifier an agent can't ask
		// for one token's transfers and pays for a full-feed scan instead.
		for (const name of ["index_ft_transfers", "index_nft_transfers"]) {
			const schema = tools.find((t) => t.name === name)?.schema;
			expect(Object.keys(schema ?? {}).sort()).toEqual([
				"assetIdentifier",
				"contractId",
				"cursor",
				"fromHeight",
				"limit",
				"recipient",
				"sender",
				"toHeight",
			]);
		}

		await tools
			.find((t) => t.name === "index_ft_transfers")
			?.handler({
				sender: "SP1",
				assetIdentifier: "SP1.sbtc-token::sbtc-token",
				limit: 5,
			});
		expect(calls.ft).toEqual({
			sender: "SP1",
			assetIdentifier: "SP1.sbtc-token::sbtc-token",
			limit: 5,
		});

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

		const schema = await tools
			.find((t) => t.name === "index_print_schema")
			?.handler({ contractId: "SP1.registry" });
		expect(calls.printSchema).toBe("SP1.registry");
		expect(schema?.content[0]?.text).toContain("SP1.registry");
	});
});
