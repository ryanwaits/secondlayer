import { describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SIP010_ABI } from "@secondlayer/stacks/clarity";
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

type Client = ReturnType<typeof import("../lib/client.ts").getClient>;

describe("scaffold MCP tools", () => {
	it("registers subgraphs_scaffold", () => {
		const tools: RegisteredTool[] = [];
		registerScaffoldTools(fakeServer(tools), () => ({}) as Client);
		expect(tools.map((t) => t.name)).toEqual(["subgraphs_scaffold"]);
	});

	it("prefers print-schema topics over contract_call sources", async () => {
		const tools: RegisteredTool[] = [];
		const client = {
			index: {
				printSchema: async () => ({
					contract_id: "SP1.dex",
					topics: [
						{
							topic: "swap",
							non_tuple: false,
							count: 1,
							first_height: 1,
							last_height: 1,
							fields: [
								{
									name: "dx",
									camel_name: "dx",
									clarity_type: "uint",
									ts_type: "bigint",
									column_type: "uint",
									always_present: true,
								},
							],
						},
					],
					sample: { size: 1, oldest_height: 1, newest_height: 1 },
				}),
			},
			contracts: {
				get: async () => {
					throw new Error("ABI must not be fetched when prints exist");
				},
			},
		};
		registerScaffoldTools(fakeServer(tools), () => client as unknown as Client);

		const res = await tools
			.find((t) => t.name === "subgraphs_scaffold")
			?.handler({ contractId: "SP1.dex" });
		expect(res?.isError).toBeUndefined();
		const text = res?.content[0]?.text ?? "";
		expect(text).toContain("defineSubgraph(");
		expect(text).toContain("type: 'print_event'");
		expect(text).toContain("topic: 'swap'");
		expect(text).toContain("prints:");
		// Must not be the ABI-only contract_call path.
		expect(text).not.toMatch(/sources:\s*\{[^}]*type:\s*'contract_call'/);
	});

	it("falls back to ft_transfer for SIP-010 when there are no prints", async () => {
		const tools: RegisteredTool[] = [];
		const client = {
			index: {
				printSchema: async () => ({
					contract_id: "SP1.token",
					topics: [],
					sample: { size: 0, oldest_height: null, newest_height: null },
				}),
			},
			contracts: {
				get: async () => ({
					contract_id: "SP1.token",
					abi_status: "ok",
					abi: SIP010_ABI,
				}),
			},
		};
		registerScaffoldTools(fakeServer(tools), () => client as unknown as Client);

		const res = await tools
			.find((t) => t.name === "subgraphs_scaffold")
			?.handler({ contractId: "SP1.token" });
		const text = res?.content[0]?.text ?? "";
		expect(text).toContain("ft_transfer");
		expect(text).toContain("SP1.token::");
		expect(text).not.toContain("type: 'contract_call'");
	});

	it("falls back to contract_call when no prints and not a token", async () => {
		const tools: RegisteredTool[] = [];
		const client = {
			index: {
				printSchema: async () => null,
			},
			contracts: {
				get: async () => ({
					contract_id: "SP1.dao",
					abi_status: "ok",
					abi: {
						functions: [
							{
								name: "propose",
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
		registerScaffoldTools(fakeServer(tools), () => client as unknown as Client);

		const res = await tools
			.find((t) => t.name === "subgraphs_scaffold")
			?.handler({ contractId: "SP1.dao" });
		const text = res?.content[0]?.text ?? "";
		expect(text).toContain("defineSubgraph(");
		expect(text).toContain("type: 'contract_call'");
		expect(text).toContain("SP1.dao");
	});
});
