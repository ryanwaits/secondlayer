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
	it("registers the cursor-paginated reads and the dumps manifest, but no live-follow tool", () => {
		const tools: RegisteredTool[] = [];
		register(tools, {});
		expect(tools.map((t) => t.name)).toEqual([
			"streams_tip",
			"streams_events",
			"streams_events_by_tx",
			"streams_block_events",
			"streams_canonical",
			"streams_reorgs",
			"streams_dumps",
		]);
	});

	it("streams_events advertises every filter the HTTP route supports", () => {
		const tools: RegisteredTool[] = [];
		register(tools, {});
		const schema = tools.find((t) => t.name === "streams_events")?.schema;
		expect(Object.keys(schema ?? {}).sort()).toEqual([
			"assetIdentifier",
			"contractId",
			"cursor",
			"fromHeight",
			"limit",
			"notTypes",
			"recipient",
			"sender",
			"toHeight",
			"types",
		]);
	});

	it("streams_events forwards filters and returns the cursor envelope", async () => {
		const tools: RegisteredTool[] = [];
		let captured: unknown;
		const byName = register(tools, {
			streams: {
				events: {
					list: async (params: unknown) => {
						captured = params;
						return {
							events: [{ cursor: "150000:3", event_type: "stx_transfer" }],
							next_cursor: "150000:4",
							tip: { block_height: 150001 },
							reorgs: [],
						};
					},
				},
			},
		});

		const res = await byName.streams_events?.({
			types: ["stx_transfer"],
			sender: ["SP1", "SP2"],
			cursor: "150000:0",
			fromHeight: 150000,
			limit: 50,
		});
		expect(res?.isError).toBeUndefined();
		expect(captured).toEqual({
			types: ["stx_transfer"],
			sender: ["SP1", "SP2"],
			cursor: "150000:0",
			fromHeight: 150000,
			limit: 50,
		});
		expect(res?.content[0]?.text).toContain('"next_cursor": "150000:4"');
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

	it("streams_events_by_tx returns one transaction's events", async () => {
		const tools: RegisteredTool[] = [];
		let requestedTxId: string | undefined;
		const byName = register(tools, {
			streams: {
				events: {
					byTxId: async (txId: string) => {
						requestedTxId = txId;
						return { events: [{ tx_id: txId, event_index: 0 }], tip: {} };
					},
				},
			},
		});
		const res = await byName.streams_events_by_tx?.({ txId: "0xabc" });
		expect(requestedTxId).toBe("0xabc");
		expect(res?.content[0]?.text).toContain("0xabc");
	});

	it("streams_block_events accepts a height or a block hash", async () => {
		const tools: RegisteredTool[] = [];
		const requested: unknown[] = [];
		const byName = register(tools, {
			streams: {
				blocks: {
					events: async (heightOrHash: number | string) => {
						requested.push(heightOrHash);
						return { events: [], tip: {} };
					},
				},
			},
		});
		await byName.streams_block_events?.({ heightOrHash: 150000 });
		await byName.streams_block_events?.({ heightOrHash: "0xdeadbeef" });
		expect(requested).toEqual([150000, "0xdeadbeef"]);
	});

	it("streams_canonical reports whether a height is still canonical", async () => {
		const tools: RegisteredTool[] = [];
		const byName = register(tools, {
			streams: {
				canonical: async (height: number) => ({
					block_height: height,
					block_hash: "0xabc",
					is_canonical: true,
				}),
			},
		});
		const res = await byName.streams_canonical?.({ height: 150000 });
		expect(res?.content[0]?.text).toContain('"is_canonical": true');
	});

	it("streams_reorgs forwards since and omits an unset limit", async () => {
		const tools: RegisteredTool[] = [];
		const captured: unknown[] = [];
		const byName = register(tools, {
			streams: {
				reorgs: {
					list: async (params: unknown) => {
						captured.push(params);
						return { reorgs: [], next_since: null };
					},
				},
			},
		});
		await byName.streams_reorgs?.({ since: "2026-08-01T00:00:00Z" });
		await byName.streams_reorgs?.({ since: "2026-08-01T00:00:00Z", limit: 10 });
		expect(captured).toEqual([
			{ since: "2026-08-01T00:00:00Z" },
			{ since: "2026-08-01T00:00:00Z", limit: 10 },
		]);
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
