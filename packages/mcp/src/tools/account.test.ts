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
	it("registers only identity + key self-provisioning", () => {
		const tools: RegisteredTool[] = [];
		registerAccountTools(fakeServer(tools));
		expect(tools.map((t) => t.name).sort()).toEqual([
			"account_create_key",
			"account_whoami",
		]);
	});

	it("whoami GETs /api/accounts/me", async () => {
		const tools: RegisteredTool[] = [];
		registerAccountTools(fakeServer(tools));
		const requests: { method?: string; url?: string }[] = [];
		globalThis.fetch = (async (input, init) => {
			const request =
				input instanceof Request ? input : new Request(input.toString(), init);
			requests.push({ method: request.method, url: request.url });
			return new Response(
				JSON.stringify({ email: "a@b.com", plan: "build" }),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;

		const whoami = tools.find((t) => t.name === "account_whoami");
		const res = await whoami?.handler({});

		expect(requests[0]?.method).toBe("GET");
		expect(requests[0]?.url).toContain("/api/accounts/me");
		expect(res?.content[0]?.text).toContain("a@b.com");
	});
});
