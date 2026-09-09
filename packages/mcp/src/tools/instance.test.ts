import { describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerInstanceTools } from "./instance.ts";

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

describe("instance MCP tools", () => {
	it("registers instance_status and passes status + diagnose through", async () => {
		const tools: RegisteredTool[] = [];
		const status = {
			status: "degraded",
			index: { decoders: [{ decoder: "decode.ft.v1", status: "unavailable" }] },
		};
		const diagnosis = {
			state: "empty-index",
			overall: "degraded",
			issues: [{ title: "No blocks indexed yet", nextSteps: [] }],
		};
		registerInstanceTools(
			fakeServer(tools),
			() =>
				({
					instance: {
						status: async () => status,
						diagnose: async () => diagnosis,
					},
				}) as never,
		);

		const tool = tools.find((t) => t.name === "instance_status");
		expect(tool).toBeDefined();
		if (!tool) throw new Error("instance_status not registered");
		expect(tool.description).toContain("empty-index");
		expect(tool.description).toContain("archive_bootstrap");
		expect(tool.description).toContain("setup");
		expect(tool.description).toMatch(/poll/i);
		expect(tool.description).toContain("decoders");
		expect(tool.description).not.toMatch(/\bconsume\b/);

		const result = await tool.handler({});
		expect(result.isError).toBeUndefined();
		const body = JSON.parse(result.content[0]?.text ?? "{}");
		expect(body.status).toEqual(status);
		expect(body.diagnosis).toEqual(diagnosis);
	});
});
