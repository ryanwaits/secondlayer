import { describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AuthError } from "@secondlayer/sdk";
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
	it("registers tip + events and passes filters through", async () => {
		const tools: RegisteredTool[] = [];
		let listed: unknown = null;
		const client = {
			streams: {
				tip: async () => ({ block_height: 100, lag_seconds: 2 }),
				events: {
					list: async (params: unknown) => {
						listed = params;
						return { events: [], next_cursor: null };
					},
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

		expect(tools.map((t) => t.name).sort()).toEqual([
			"streams_events",
			"streams_tip",
		]);

		await tools
			.find((t) => t.name === "streams_events")
			?.handler({ types: ["ft_transfer"], limit: 3 });
		expect(listed).toEqual({ types: ["ft_transfer"], limit: 3 });
	});

	it("decorates a keyless AuthError with the API-key hint", async () => {
		const tools: RegisteredTool[] = [];
		const client = {
			streams: {
				tip: async () => {
					throw new AuthError("unauthorized");
				},
				events: { list: async () => ({ events: [] }) },
			},
		};
		registerStreamsTools(
			fakeServer(tools),
			() =>
				client as unknown as ReturnType<
					typeof import("../lib/client.ts").getClient
				>,
		);

		const res = await tools.find((t) => t.name === "streams_tip")?.handler({});
		expect(res?.isError).toBe(true);
		expect(res?.content[0]?.text).toContain("SL_API_KEY");
		expect(res?.content[0]?.text).toContain("unauthorized");
	});
});
