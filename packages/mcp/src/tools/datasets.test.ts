import { describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDatasetTools } from "./datasets.ts";

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

describe("dataset MCP tools", () => {
	it("registers list + query and passes merged query params", async () => {
		const tools: RegisteredTool[] = [];
		let queried: unknown = null;
		const client = {
			datasets: {
				listDatasets: async () => ({ datasets: [{ slug: "stx-transfers" }] }),
				query: async (slug: string, params: Record<string, unknown>) => {
					queried = { slug, params };
					return {
						rows: [{ id: 1 }],
						next_cursor: "c1",
						tip: { block_height: 9 },
					};
				},
			},
		};
		registerDatasetTools(
			fakeServer(tools),
			() =>
				client as unknown as ReturnType<
					typeof import("../lib/client.ts").getClient
				>,
		);

		expect(tools.map((t) => t.name).sort()).toEqual([
			"datasets_list",
			"datasets_query",
		]);

		const list = tools.find((t) => t.name === "datasets_list");
		const listed = await list?.handler({});
		expect(listed?.content[0]?.text).toContain("stx-transfers");

		const query = tools.find((t) => t.name === "datasets_query");
		const res = await query?.handler({
			slug: "stx-transfers",
			filters: { sender: "SP1" },
			limit: 10,
			cursor: "abc",
		});
		expect(queried).toEqual({
			slug: "stx-transfers",
			params: { sender: "SP1", limit: 10, cursor: "abc" },
		});
		expect(res?.content[0]?.text).toContain("next_cursor");
	});
});
