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
	it("registers identity, keys, usage, and caps tools", () => {
		const tools: RegisteredTool[] = [];
		registerAccountTools(fakeServer(tools));
		expect(tools.map((t) => t.name).sort()).toEqual([
			"account_billing",
			"account_create_key",
			"account_get_caps",
			"account_list_keys",
			"account_revoke_key",
			"account_set_caps",
			"account_update",
			"account_usage",
			"account_whoami",
		]);
	});

	it("set_caps PATCHes /api/billing/caps with only provided fields", async () => {
		const tools: RegisteredTool[] = [];
		registerAccountTools(fakeServer(tools));
		const requests: { method?: string; url?: string; body?: unknown }[] = [];
		globalThis.fetch = (async (input, init) => {
			const request =
				input instanceof Request ? input : new Request(input.toString(), init);
			requests.push({
				method: request.method,
				url: request.url,
				body: JSON.parse(await request.text()),
			});
			return new Response(JSON.stringify({ monthlyCapCents: 5000 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		const setCaps = tools.find((t) => t.name === "account_set_caps");
		await setCaps?.handler({ monthlyCapCents: 5000 });

		expect(requests[0]?.method).toBe("PATCH");
		expect(requests[0]?.url).toContain("/api/billing/caps");
		expect(requests[0]?.body).toEqual({ monthlyCapCents: 5000 });
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
