import { afterEach, describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HOSTED_KEY_HINT } from "../lib/client.ts";
import { registerArchiveTools } from "./archive.ts";

interface RegisteredTool {
	name: string;
	description: string;
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
			description: string,
			schema: Record<string, unknown>,
			handler: RegisteredTool["handler"],
		) => {
			tools.push({ name, description, schema, handler });
		},
	} as unknown as McpServer;
}

const against = "https://archive.secondlayer.tools/latest.json";

describe("archive MCP tools", () => {
	const originalArchiveKey = process.env.SL_ARCHIVE_API_KEY;
	const originalToken = process.env.INSTANCE_TOKEN;

	afterEach(() => {
		if (originalArchiveKey === undefined) delete process.env.SL_ARCHIVE_API_KEY;
		else process.env.SL_ARCHIVE_API_KEY = originalArchiveKey;
		if (originalToken === undefined) delete process.env.INSTANCE_TOKEN;
		else process.env.INSTANCE_TOKEN = originalToken;
	});

	it("archive_verify returns unanchored JSON without throwing", async () => {
		const tools: RegisteredTool[] = [];
		const calls: unknown[] = [];
		registerArchiveTools(
			fakeServer(tools),
			() =>
				({
					archive: {
						verify: async (input: unknown) => {
							calls.push(input);
							return {
								status: "unanchored",
								target: "raw",
								against,
								signature: { verified: false, reason: "missing key" },
								ranges: [],
							};
						},
					},
				}) as never,
			() => {
				throw new Error("hosted client must not be used for verify");
			},
		);

		const tool = tools.find((t) => t.name === "archive_verify");
		expect(tool).toBeDefined();
		if (!tool) throw new Error("archive_verify not registered");
		expect(tool.description).toContain("unanchored");
		expect(tool.description).toMatch(/not that the instance is fine/i);
		expect(tool.description).not.toMatch(/\bconsume\b/);

		const result = await tool.handler({
			against,
			fromBlock: 0,
			toBlock: 99,
			target: "raw",
		});
		expect(result.isError).toBeUndefined();
		const body = JSON.parse(result.content[0]?.text ?? "{}");
		expect(body.status).toBe("unanchored");
		expect(calls).toEqual([
			{ against, fromBlock: 0, toBlock: 99, target: "raw" },
		]);
	});

	it("credits_balance errors when only INSTANCE_TOKEN is set", async () => {
		delete process.env.SL_ARCHIVE_API_KEY;
		process.env.INSTANCE_TOKEN = "instance-token";

		const tools: RegisteredTool[] = [];
		registerArchiveTools(fakeServer(tools));
		const tool = tools.find((t) => t.name === "credits_balance");
		expect(tool).toBeDefined();
		if (!tool) throw new Error("credits_balance not registered");

		const result = await tool.handler({});
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain(HOSTED_KEY_HINT);
	});

	it("hosted quote uses the archive ops client, not the instance", async () => {
		const tools: RegisteredTool[] = [];
		let hostedCalled = false;
		registerArchiveTools(
			fakeServer(tools),
			() => {
				throw new Error("instance client must not be used for quote");
			},
			() =>
				({
					archive: {
						quote: async (input: unknown) => {
							hostedCalled = true;
							return { usd: "1.00", sufficient: true, paths: input };
						},
					},
				}) as never,
		);

		const tool = tools.find((t) => t.name === "archive_quote");
		if (!tool) throw new Error("archive_quote not registered");
		const result = await tool.handler({
			paths: ["blocks/0-99999.parquet"],
			flow: "bootstrap",
		});
		expect(result.isError).toBeUndefined();
		expect(hostedCalled).toBe(true);
	});

	it("does not register a consume tool", () => {
		const tools: RegisteredTool[] = [];
		registerArchiveTools(fakeServer(tools), () => ({}) as never);
		expect(tools.map((t) => t.name)).not.toContain("consume");
		expect(tools.some((t) => t.name.includes("consume"))).toBe(false);
	});
});
