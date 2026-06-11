import { describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerStreamsTools } from "./streams.ts";

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

describe("streams MCP tools", () => {
	it("registers only the dumps tool (live Streams reads are REST-only)", () => {
		const tools: RegisteredTool[] = [];
		registerStreamsTools(fakeServer(tools), () => ({}) as never);
		expect(tools.map((t) => t.name)).toEqual(["streams_dumps"]);
	});

	it("streams_dumps returns the bulk parquet manifest", async () => {
		const tools: RegisteredTool[] = [];
		const client = {
			streams: {
				dumps: {
					list: async () => ({
						coverage: { from_block: 0, to_block: 100 },
						latest_finalized_cursor: "100:0",
						files: [{ path: "a.parquet", row_count: 5 }],
					}),
				},
			},
		};
		registerStreamsTools(
			fakeServer(tools),
			() =>
				client as unknown as ReturnType<
					typeof import("../lib/client.ts").getClient
				>,
		);
		const res = await tools
			.find((t) => t.name === "streams_dumps")
			?.handler({});
		expect(res?.isError).toBeUndefined();
		expect(res?.content[0]?.text).toContain("latest_finalized_cursor");
		expect(res?.content[0]?.text).toContain("a.parquet");
	});
});
