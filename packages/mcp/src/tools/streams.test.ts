import { describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerStreamsTools } from "./streams.ts";

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

function register(tools: RegisteredTool[], client: unknown) {
	registerStreamsTools(
		fakeServer(tools),
		() =>
			client as unknown as ReturnType<
				typeof import("../lib/client.ts").getClient
			>,
	);
	return Object.fromEntries(tools.map((tool) => [tool.name, tool.handler]));
}

describe("streams MCP tools", () => {
	it("registers tip and dumps only — live Streams reads are REST", () => {
		const tools: RegisteredTool[] = [];
		register(tools, {});
		expect(tools.map((t) => t.name)).toEqual(["streams_tip", "streams_dumps"]);
	});

	it("streams_tip returns the tip and its seekable floor", async () => {
		const tools: RegisteredTool[] = [];
		const byName = register(tools, {
			streams: {
				tip: async () => ({
					block_height: 150001,
					finalized_height: 149901,
					oldest_seekable_height: 100000,
				}),
			},
		});
		const res = await byName.streams_tip?.({});
		expect(res?.isError).toBeUndefined();
		expect(res?.content[0]?.text).toContain('"oldest_seekable_height": 100000');
	});

	it("streams_dumps returns the bulk parquet manifest", async () => {
		const tools: RegisteredTool[] = [];
		const byName = register(tools, {
			streams: {
				dumps: {
					list: async () => ({
						coverage: { from_block: 0, to_block: 100 },
						latest_finalized_cursor: "100:0",
						files: [{ path: "a.parquet", row_count: 5 }],
					}),
				},
			},
		});
		const res = await byName.streams_dumps?.({});
		expect(res?.isError).toBeUndefined();
		expect(res?.content[0]?.text).toContain("latest_finalized_cursor");
		expect(res?.content[0]?.text).toContain("a.parquet");
	});

	it("surfaces a backend failure as a structured tool error", async () => {
		const tools: RegisteredTool[] = [];
		const byName = register(tools, {
			streams: {
				tip: async () => {
					throw Object.assign(new Error("API key invalid or expired."), {
						status: 401,
					});
				},
			},
		});
		const res = await byName.streams_tip?.({});
		expect(res?.isError).toBe(true);
		expect(res?.content[0]?.text).toContain('"type":"unauthorized"');
	});
});
