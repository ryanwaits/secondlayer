import { describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSubgraphTools } from "./subgraphs.ts";

interface RegisteredTool {
	name: string;
	schema: Record<string, unknown>;
	handler: (args: Record<string, unknown>) => Promise<{
		content: Array<{ type: "text"; text: string }>;
		isError?: boolean;
	}>;
}

const DEPLOY_SOURCE = `import { defineSubgraph } from "@secondlayer/subgraphs";
export default defineSubgraph({
  name: "dex",
  sources: { calls: { type: "contract_call", contractId: "SP.dex" } },
  schema: { swaps: { columns: { amount: { type: "uint" } } } },
  handlers: { calls: async () => {} },
});`;

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

describe("subgraph MCP tools", () => {
	it("registers subgraphs_deploy startBlock input", () => {
		const tools: RegisteredTool[] = [];
		registerSubgraphTools(fakeServer(tools), () => ({}) as never);

		const deploy = tools.find((tool) => tool.name === "subgraphs_deploy");
		expect(deploy).toBeDefined();
		const startBlock = deploy?.schema.startBlock as {
			safeParse: (value: unknown) => { success: boolean };
		};
		expect(startBlock.safeParse(0).success).toBe(true);
		expect(startBlock.safeParse(123).success).toBe(true);
		expect(startBlock.safeParse(-1).success).toBe(false);
		expect(startBlock.safeParse(1.5).success).toBe(false);
	});

	it("subgraphs_backfill forwards the block range and returns the operation", async () => {
		const tools: RegisteredTool[] = [];
		let captured: { name: string; options: unknown } | undefined;
		registerSubgraphTools(
			fakeServer(tools),
			() =>
				({
					subgraphs: {
						backfill: async (name: string, options: unknown) => {
							captured = { name, options };
							return {
								message: "queued",
								operationId: "op_1",
								status: "queued",
							};
						},
					},
				}) as never,
		);

		const backfill = tools.find((tool) => tool.name === "subgraphs_backfill");
		expect(backfill).toBeDefined();
		if (!backfill) throw new Error("subgraphs_backfill not registered");

		const result = await backfill.handler({
			name: "dex",
			fromBlock: 150000,
			toBlock: 160000,
		});
		expect(result.isError).toBeUndefined();
		expect(captured).toEqual({
			name: "dex",
			options: { fromBlock: 150000, toBlock: 160000 },
		});
		expect(result.content[0]?.text).toContain('"operationId": "op_1"');
	});

	it("subgraphs_stop cancels the in-flight operation", async () => {
		const tools: RegisteredTool[] = [];
		let stoppedName: string | undefined;
		registerSubgraphTools(
			fakeServer(tools),
			() =>
				({
					subgraphs: {
						stop: async (name: string) => {
							stoppedName = name;
							return {
								message: "stopping",
								operationId: "op_1",
								status: "cancel_requested",
							};
						},
					},
				}) as never,
		);

		const stop = tools.find((tool) => tool.name === "subgraphs_stop");
		expect(stop).toBeDefined();
		if (!stop) throw new Error("subgraphs_stop not registered");

		const result = await stop.handler({ name: "dex" });
		expect(result.isError).toBeUndefined();
		expect(stoppedName).toBe("dex");
		expect(result.content[0]?.text).toContain("cancel_requested");
	});

	it("subgraphs_gaps forwards opts and returns ranges", async () => {
		const tools: RegisteredTool[] = [];
		let captured: { name: string; opts: unknown } | undefined;
		registerSubgraphTools(
			fakeServer(tools),
			() =>
				({
					subgraphs: {
						gaps: async (name: string, opts: unknown) => {
							captured = { name, opts };
							return {
								data: [
									{
										start: 100,
										end: 110,
										size: 11,
										reason: "skipped",
										detectedAt: "2026-06-07T00:00:00Z",
										resolvedAt: null,
									},
								],
								meta: {
									total: 1,
									totalMissingBlocks: 11,
									limit: 50,
									offset: 0,
								},
							};
						},
					},
				}) as never,
		);

		const gaps = tools.find((tool) => tool.name === "subgraphs_gaps");
		expect(gaps).toBeDefined();
		if (!gaps) throw new Error("subgraphs_gaps not registered");

		const result = await gaps.handler({
			name: "dex",
			limit: 50,
			resolved: false,
		});
		expect(result.isError).toBeUndefined();
		expect(captured).toEqual({
			name: "dex",
			opts: { limit: 50, offset: undefined, resolved: false },
		});
		expect(result.content[0]?.text).toContain('"totalMissingBlocks": 11');
	});

	it("subgraphs_operations lists history and fetches one operation by id", async () => {
		const tools: RegisteredTool[] = [];
		const calls: string[] = [];
		registerSubgraphTools(
			fakeServer(tools),
			() =>
				({
					subgraphs: {
						operations: async (name: string) => {
							calls.push(`list:${name}`);
							return {
								operations: [{ id: "op_1", status: "running" }],
							};
						},
						getOperation: async (name: string, operationId: string) => {
							calls.push(`get:${name}:${operationId}`);
							return { id: operationId, status: "completed" };
						},
					},
				}) as never,
		);

		const operations = tools.find(
			(tool) => tool.name === "subgraphs_operations",
		);
		if (!operations) throw new Error("subgraphs_operations not registered");

		const list = await operations.handler({ name: "dex" });
		expect(list.isError).toBeUndefined();
		expect(list.content[0]?.text).toContain('"status": "running"');

		const one = await operations.handler({ name: "dex", operationId: "op_1" });
		expect(one.content[0]?.text).toContain('"status": "completed"');
		expect(calls).toEqual(["list:dex", "get:dex:op_1"]);
	});

	it("subgraphs_spec serves the agent schema by default and switches on format", async () => {
		const tools: RegisteredTool[] = [];
		const calls: string[] = [];
		registerSubgraphTools(
			fakeServer(tools),
			() =>
				({
					subgraphs: {
						schema: async (name: string) => {
							calls.push(`schema:${name}`);
							return { name, tables: { swaps: { columns: {} } } };
						},
						openapi: async (name: string) => {
							calls.push(`openapi:${name}`);
							return { openapi: "3.1.0", info: { title: name } };
						},
						markdown: async (name: string) => {
							calls.push(`markdown:${name}`);
							return `# ${name}`;
						},
					},
				}) as never,
		);

		const spec = tools.find((tool) => tool.name === "subgraphs_spec");
		if (!spec) throw new Error("subgraphs_spec not registered");

		const agent = await spec.handler({ name: "dex" });
		expect(agent.content[0]?.text).toContain('"swaps"');

		const openapi = await spec.handler({ name: "dex", format: "openapi" });
		expect(openapi.content[0]?.text).toContain('"openapi": "3.1.0"');

		const markdown = await spec.handler({ name: "dex", format: "markdown" });
		expect(markdown.content[0]?.text).toBe("# dex");

		expect(calls).toEqual(["schema:dex", "openapi:dex", "markdown:dex"]);
	});

	// Publishing claimed a subgraph name in a hosted global namespace. A
	// self-hosted instance has no such namespace, so the tools were deleted
	// rather than left answering NOT_SUPPORTED — an agent should not see a
	// verb it can never use.
	it("registers no public-namespace tools", () => {
		const tools: RegisteredTool[] = [];
		registerSubgraphTools(fakeServer(tools), () => ({}) as never);

		const names = tools.map((tool) => tool.name);
		expect(names).not.toContain("subgraphs_publish");
		expect(names).not.toContain("subgraphs_unpublish");
		expect(names.join(" ")).not.toContain("visibility");
	});

	it("subgraphs_deploy forwards dryRun and returns the DDL preview", async () => {
		const tools: RegisteredTool[] = [];
		let captured: Record<string, unknown> | undefined;
		registerSubgraphTools(
			fakeServer(tools),
			() =>
				({
					subgraphs: {
						deploy: async (data: Record<string, unknown>) => {
							captured = data;
							// The server returns the dry-run preview shape (not DeploySubgraphResponse).
							return {
								dryRun: true,
								schemaName: "subgraph_dex",
								statements: ["CREATE TABLE ..."],
							};
						},
					},
				}) as never,
		);

		const deploy = tools.find((tool) => tool.name === "subgraphs_deploy");
		if (!deploy) throw new Error("subgraphs_deploy not registered");

		const result = await deploy.handler({
			code: DEPLOY_SOURCE,
			dryRun: true,
		});
		expect(result.isError).toBeUndefined();
		expect(captured?.dryRun).toBe(true);
		expect(result.content[0]?.text).toContain('"dryRun": true');
		expect(result.content[0]?.text).toContain("subgraph_dex");
	});

	const PRINT_ROW = {
		cursor: "c1",
		block_height: 10,
		tx_id: "0x1",
		tx_index: 0,
		event_index: 0,
		event_type: "print",
		contract_id: "SP.dex",
		payload: { topic: "swap", value: { "token-x": "SP.token" } },
	};

	function testSource(handlerBody: string): string {
		return `import { defineSubgraph } from "@secondlayer/subgraphs";
export default defineSubgraph({
  name: "dex-test",
  sources: { prints: { type: "print_event", contractId: "SP.dex" } },
  schema: { swaps: { columns: { token_x: { type: "text" } } } },
  handlers: {
    prints: (event, ctx) => {
      ${handlerBody}
    },
  },
});`;
	}

	it("registers subgraphs_test", () => {
		const tools: RegisteredTool[] = [];
		registerSubgraphTools(fakeServer(tools), () => ({}) as never);
		expect(tools.map((t) => t.name)).toContain("subgraphs_test");
	});

	it("subgraphs_test returns ok when the mapping writes rows", async () => {
		const tools: RegisteredTool[] = [];
		registerSubgraphTools(
			fakeServer(tools),
			() =>
				({
					index: {
						events: {
							list: async () => ({ events: [PRINT_ROW], next_cursor: null }),
						},
						contractCalls: { list: async () => ({ contract_calls: [] }) },
					},
				}) as never,
		);

		const tool = tools.find((t) => t.name === "subgraphs_test");
		if (!tool) throw new Error("subgraphs_test not registered");

		const result = await tool.handler({
			code: testSource(`
        const tokenX = event.data.tokenX;
        if (tokenX == null) return;
        ctx.insert("swaps", { token_x: tokenX });
      `),
			fromHeight: 10,
			toHeight: 20,
		});
		expect(result.isError).toBeUndefined();
		const body = JSON.parse(result.content[0]?.text ?? "{}") as {
			ok: boolean;
			written: number;
			code?: string;
		};
		expect(body.ok).toBe(true);
		expect(body.written).toBe(1);
	});

	it("subgraphs_test fail-closes EMPTY_MAPPING with observed keys", async () => {
		const tools: RegisteredTool[] = [];
		registerSubgraphTools(
			fakeServer(tools),
			() =>
				({
					index: {
						events: {
							list: async () => ({ events: [PRINT_ROW], next_cursor: null }),
						},
						contractCalls: { list: async () => ({ contract_calls: [] }) },
					},
				}) as never,
		);

		const tool = tools.find((t) => t.name === "subgraphs_test");
		if (!tool) throw new Error("subgraphs_test not registered");

		const result = await tool.handler({
			code: testSource(`
        const amountIn = event.data.amountIn;
        if (amountIn == null) return;
        ctx.insert("swaps", { token_x: amountIn });
      `),
			fromHeight: 10,
			toHeight: 20,
		});
		expect(result.isError).toBe(true);
		const body = JSON.parse(result.content[0]?.text ?? "{}") as {
			ok: boolean;
			code?: string;
			hint?: string;
			written: number;
		};
		expect(body.ok).toBe(false);
		expect(body.code).toBe("EMPTY_MAPPING");
		expect(body.written).toBe(0);
		expect(body.hint).toContain("tokenX");
		expect(body.hint).toContain("do not invent fields");
	});

	function mixedPrintDeploySource(handlerBody: string): string {
		return `import { defineSubgraph } from "@secondlayer/subgraphs";
export default defineSubgraph({
  name: "dex-test",
  sources: {
    prints: { type: "print_event", contractId: "SP.dex" },
    deploys: { type: "contract_deploy" },
  },
  schema: { swaps: { columns: { token_x: { type: "text" } } } },
  handlers: {
    prints: (event, ctx) => {
      ${handlerBody}
    },
    deploys: async () => {},
  },
});`;
	}

	it("subgraphs_test names skipped contract_deploy while print still writes", async () => {
		const tools: RegisteredTool[] = [];
		registerSubgraphTools(
			fakeServer(tools),
			() =>
				({
					index: {
						events: {
							list: async () => ({ events: [PRINT_ROW], next_cursor: null }),
						},
						contractCalls: { list: async () => ({ contract_calls: [] }) },
					},
				}) as never,
		);

		const tool = tools.find((t) => t.name === "subgraphs_test");
		if (!tool) throw new Error("subgraphs_test not registered");

		const result = await tool.handler({
			code: mixedPrintDeploySource(`
        const tokenX = event.data.tokenX;
        if (tokenX == null) return;
        ctx.insert("swaps", { token_x: tokenX });
      `),
			fromHeight: 10,
			toHeight: 20,
		});
		expect(result.isError).toBeUndefined();
		const body = JSON.parse(result.content[0]?.text ?? "{}") as {
			ok: boolean;
			written: number;
			hint?: string;
			skipped: Array<{ source: string; reason: string }>;
		};
		expect(body.ok).toBe(true);
		expect(body.written).toBe(1);
		expect(body.skipped).toHaveLength(1);
		expect(body.skipped[0]?.source).toBe("deploys");
		expect(body.skipped[0]?.reason).toContain("contract_deploy");
		expect(body.hint).toContain("contract_deploy");
	});

	it("subgraphs_test returns NO_SOURCES with skipped when all sources unreadable", async () => {
		const tools: RegisteredTool[] = [];
		registerSubgraphTools(
			fakeServer(tools),
			() =>
				({
					index: {
						events: {
							list: async () => ({ events: [], next_cursor: null }),
						},
						contractCalls: { list: async () => ({ contract_calls: [] }) },
					},
				}) as never,
		);

		const tool = tools.find((t) => t.name === "subgraphs_test");
		if (!tool) throw new Error("subgraphs_test not registered");

		const result = await tool.handler({
			code: `import { defineSubgraph } from "@secondlayer/subgraphs";
export default defineSubgraph({
  name: "dex-test",
  sources: { deploys: { type: "contract_deploy" } },
  schema: { swaps: { columns: { token_x: { type: "text" } } } },
  handlers: { deploys: async () => {} },
});`,
			fromHeight: 10,
			toHeight: 20,
		});
		expect(result.isError).toBe(true);
		const body = JSON.parse(result.content[0]?.text ?? "{}") as {
			ok: boolean;
			code?: string;
			skipped: Array<{ source: string; reason: string }>;
		};
		expect(body.ok).toBe(false);
		expect(body.code).toBe("NO_SOURCES");
		expect(body.skipped.length).toBeGreaterThan(0);
		expect(body.skipped[0]?.reason).toContain("contract_deploy");
	});
});
