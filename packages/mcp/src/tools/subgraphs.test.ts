import { describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ByoBreakingChangeError } from "@secondlayer/sdk";
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

	it("subgraphs_deploy forwards databaseUrl and dryRun, returns the BYO preview", async () => {
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
								connection: "ok",
								schemaName: "subgraph_dex",
								statements: ["CREATE TABLE ..."],
								grantScript: "GRANT ...",
							};
						},
					},
				}) as never,
		);

		const deploy = tools.find((tool) => tool.name === "subgraphs_deploy");
		if (!deploy) throw new Error("subgraphs_deploy not registered");

		const result = await deploy.handler({
			code: DEPLOY_SOURCE,
			databaseUrl: "postgres://user:pass@host:5432/db",
			dryRun: true,
		});
		expect(result.isError).toBeUndefined();
		expect(captured?.databaseUrl).toBe("postgres://user:pass@host:5432/db");
		expect(captured?.dryRun).toBe(true);
		expect(result.content[0]?.text).toContain('"dryRun": true');
		expect(result.content[0]?.text).toContain("subgraph_dex");
	});

	it("subgraphs_deploy surfaces a refused BYO breaking change as an actionable result", async () => {
		const tools: RegisteredTool[] = [];
		registerSubgraphTools(
			fakeServer(tools),
			() =>
				({
					subgraphs: {
						deploy: async () => {
							throw new ByoBreakingChangeError("breaking change", {
								reasons: ["column dropped"],
								diff: {
									addedTables: [],
									removedTables: [],
									addedColumns: {},
									breakingChanges: ["column dropped"],
								},
								plan: {
									schemaName: "subgraph_dex",
									dropStatement: "DROP SCHEMA subgraph_dex CASCADE;",
									statements: ["CREATE TABLE ..."],
									grantScript: "GRANT ...",
								},
							});
						},
					},
				}) as never,
		);

		const deploy = tools.find((tool) => tool.name === "subgraphs_deploy");
		if (!deploy) throw new Error("subgraphs_deploy not registered");

		const result = await deploy.handler({
			code: DEPLOY_SOURCE,
			databaseUrl: "postgres://user:pass@host:5432/db",
		});
		// Actionable, not a failure — the agent needs the migration plan.
		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toContain('"byoBreakingChange": true');
		expect(result.content[0]?.text).toContain(
			"DROP SCHEMA subgraph_dex CASCADE;",
		);
	});
});
