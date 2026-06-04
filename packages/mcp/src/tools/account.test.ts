import { afterEach, describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAccountTools } from "./account.ts";

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

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("account MCP tools", () => {
	it("registers whoami, update, billing, and create-key", () => {
		const tools: RegisteredTool[] = [];
		registerAccountTools(fakeServer(tools));
		expect(tools.map((t) => t.name).sort()).toEqual([
			"account_billing",
			"account_create_key",
			"account_update",
			"account_whoami",
		]);
	});

	it("update PATCHes the profile with snake_case fields", async () => {
		const tools: RegisteredTool[] = [];
		registerAccountTools(fakeServer(tools));
		const requests: { method?: string; body?: unknown }[] = [];
		globalThis.fetch = (async (input, init) => {
			const request =
				input instanceof Request ? input : new Request(input.toString(), init);
			requests.push({
				method: request.method,
				body: JSON.parse(await request.text()),
			});
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		const update = tools.find((t) => t.name === "account_update");
		await update?.handler({ displayName: "Ada", bio: "hi" });

		expect(requests[0]?.method).toBe("PATCH");
		expect(requests[0]?.body).toEqual({ display_name: "Ada", bio: "hi" });
	});
});
