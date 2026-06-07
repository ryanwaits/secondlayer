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

		expect(tools.map((t) => t.name).sort()).toEqual([
			"contracts_find",
			"generate_contract_interface",
			"get_contract_abi",
		]);
		const res = await tools
			.find((t) => t.name === "contracts_find")
			?.handler({
				trait: "sip-010",
				conformance: "inferred",
			});
		expect(received).toEqual({ trait: "sip-010", conformance: "inferred" });
		expect(res?.content[0]?.text).toContain("SP1.token");
	});

	it("get_contract_abi fetches a single contract's ABI (includeAbi)", async () => {
		const tools: RegisteredTool[] = [];
		let captured: { id: string; opts: unknown } | undefined;
		const client = {
			contracts: {
				get: async (id: string, opts: unknown) => {
					captured = { id, opts };
					return { contract_id: id, abi_status: "ok", abi: { functions: [] } };
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
		const res = await tools
			.find((t) => t.name === "get_contract_abi")
			?.handler({ contractId: "SP1.token" });
		expect(captured).toEqual({ id: "SP1.token", opts: { includeAbi: true } });
		expect(res?.isError).toBeUndefined();
		expect(res?.content[0]?.text).toContain("abi");
	});

	it("get_contract_abi → not_found when absent", async () => {
		const tools: RegisteredTool[] = [];
		registerContractTools(
			fakeServer(tools),
			() =>
				({ contracts: { get: async () => null } }) as unknown as ReturnType<
					typeof import("../lib/client.ts").getClient
				>,
		);
		const res = await tools
			.find((t) => t.name === "get_contract_abi")
			?.handler({ contractId: "SP1.missing" });
		expect(res?.isError).toBe(true);
		expect(res?.content[0]?.text).toContain("not_found");
	});

	it("generate_contract_interface builds a typed client from the registry ABI", async () => {
		const tools: RegisteredTool[] = [];
		const client = {
			contracts: {
				get: async () => ({
					contract_id: "SP1.token",
					abi_status: "ok",
					abi: {
						functions: [
							{
								name: "transfer",
								access: "public",
								args: [],
								outputs: {
									type: { response: { ok: "bool", error: "uint128" } },
								},
							},
						],
						maps: [],
						variables: [],
						fungible_tokens: [],
						non_fungible_tokens: [],
					},
				}),
			},
		};
		registerContractTools(
			fakeServer(tools),
			() =>
				client as unknown as ReturnType<
					typeof import("../lib/client.ts").getClient
				>,
		);
		const res = await tools
			.find((t) => t.name === "generate_contract_interface")
			?.handler({ contractId: "SP1.token" });
		expect(res?.isError).toBeUndefined();
		expect(res?.content[0]?.text).toContain("export const token");
		expect(res?.content[0]?.text).toContain("transfer");
	});
});
