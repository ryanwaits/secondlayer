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
			"streams_block_events",
			"streams_canonical",
			"streams_consume",
			"streams_event_by_txid",
			"streams_events",
			"streams_reorgs",
			"streams_tip",
			"streams_usage",
		]);

		await tools
			.find((t) => t.name === "streams_events")
			?.handler({ types: ["ft_transfer"], limit: 3 });
		expect(listed).toEqual({ types: ["ft_transfer"], limit: 3 });

		// Regression: the tool once declared fromBlock/toBlock while the SDK
		// expects fromHeight/toHeight, so block-range filters were silently dropped.
		await tools
			.find((t) => t.name === "streams_events")
			?.handler({ fromHeight: 10, toHeight: 20 });
		expect(listed).toEqual({ fromHeight: 10, toHeight: 20 });
	});

	it("streams_consume clamps bounds and returns accumulated events + resume cursor", async () => {
		const tools: RegisteredTool[] = [];
		let consumeParams: { batchSize?: number; maxPages?: number } = {};
		const client = {
			streams: {
				tip: async () => ({}),
				events: {
					list: async () => ({ events: [] }),
					// biome-ignore lint/suspicious/noExplicitAny: test double
					consume: async (params: any) => {
						consumeParams = params;
						await params.onBatch([{ cursor: "10:1" }, { cursor: "10:2" }]);
						await params.onReorg?.({ fork_point_height: 9 });
						return { cursor: "10:2", pages: 1, emptyPolls: 0 };
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

		const res = await tools
			.find((t) => t.name === "streams_consume")
			?.handler({ batchSize: 99999, maxPages: 0, fromCursor: "10:0" });
		// Clamped: batchSize ≤ 1000, maxPages ≥ 1, bounded mode.
		expect(consumeParams.batchSize).toBe(1000);
		expect(consumeParams.maxPages).toBe(1);
		const body = JSON.parse(res?.content[0]?.text ?? "{}");
		expect(body.events).toHaveLength(2);
		expect(body.reorgs).toHaveLength(1);
		expect(body.cursor).toBe("10:2");
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
