import { afterEach, describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAccountTools } from "./account.ts";

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

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("account MCP tools", () => {
	it("registers identity and key tools, nothing that revokes", () => {
		const tools: RegisteredTool[] = [];
		registerAccountTools(fakeServer(tools));
		expect(tools.map((t) => t.name).sort()).toEqual([
			"account_create_key",
			"account_list_keys",
			"account_rotate_key",
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
			return new Response(JSON.stringify({ email: "a@b.com", plan: "build" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		const whoami = tools.find((t) => t.name === "account_whoami");
		const res = await whoami?.handler({});

		expect(requests[0]?.method).toBe("GET");
		expect(requests[0]?.url).toContain("/api/accounts/me");
		expect(res?.content[0]?.text).toContain("a@b.com");
	});

	it("create_key POSTs /api/keys without a product field", async () => {
		const tools: RegisteredTool[] = [];
		registerAccountTools(fakeServer(tools));
		const create = tools.find((t) => t.name === "account_create_key");
		expect(create?.schema.product).toBeUndefined();
		expect(create?.description).toContain("api.secondlayer.tools");

		const bodies: unknown[] = [];
		globalThis.fetch = (async (input, init) => {
			const request =
				input instanceof Request ? input : new Request(input.toString(), init);
			bodies.push(JSON.parse((await request.text()) || "{}"));
			return new Response(JSON.stringify({ key: "sk-sl_once" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		await create?.handler({ name: "ops" });
		expect(bodies[0]).toEqual({ name: "ops" });
	});

	describe("list and rotate keys", () => {
		const RUNNING = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		const OTHER = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
		const row = (
			id: string,
			prefix: string,
			overrides: Record<string, unknown> = {},
		) => ({
			id,
			prefix,
			name: "ci",
			status: "active",
			product: "account",
			tier: "free",
			createdAt: "2026-11-01T00:00:00.000Z",
			lastUsedAt: null,
			expiresAt: null,
			rowsDaily: 5,
			rows30d: 50,
			...overrides,
		});
		const KEYS = [
			row(RUNNING, "sk-sl_run00001"),
			row(OTHER, "sk-sl_oth00002", { name: "laptop" }),
			row("r", "sk-sl_rev00003", { status: "revoked" }),
			row("d", "sk-sl_doc00004", { product: "docs" }),
		];

		function setup(currentKey: string | undefined) {
			const tools: RegisteredTool[] = [];
			const calls: { method: string; path: string; body?: unknown }[] = [];
			const request = (async (method: string, path: string, body?: unknown) => {
				calls.push({ method, path, body });
				if (method === "GET") return { keys: KEYS };
				return { key: "sk-sl_new", id: "new" };
			}) as Parameters<typeof registerAccountTools>[1];
			registerAccountTools(fakeServer(tools), request, () => currentKey);
			const tool = (name: string) => {
				const found = tools.find((t) => t.name === name);
				if (!found) throw new Error(`missing tool ${name}`);
				return found;
			};
			return { calls, tool };
		}

		it("list returns active account keys without rowsDaily or a secret", async () => {
			const { calls, tool } = setup(undefined);
			const list = tool("account_list_keys");
			expect(list.description).toContain("Never returns a secret");

			const res = await list.handler({});
			const body = JSON.parse(res.content[0]?.text ?? "") as {
				keys: Record<string, unknown>[];
			};
			expect(body.keys.map((k) => k.id)).toEqual([RUNNING, OTHER]);
			for (const k of body.keys) {
				expect(k.rowsDaily).toBeUndefined();
				expect(k.key).toBeUndefined();
			}
			expect(calls).toEqual([
				{ method: "GET", path: "/api/keys", body: undefined },
			]);
		});

		it("rotate POSTs to the key's rotate path and returns the new key", async () => {
			const { calls, tool } = setup("sk-sl_run00001secret");
			const res = await tool("account_rotate_key").handler({ id: OTHER });

			expect(res.isError).toBeUndefined();
			expect(res.content[0]?.text).toContain("sk-sl_new");
			expect(calls.at(-1)).toEqual({
				method: "POST",
				path: `/api/keys/${OTHER}/rotate`,
				body: {},
			});
		});

		it("rotate refuses the key the server runs on and sends no POST", async () => {
			const { calls, tool } = setup("sk-sl_run00001secret");
			const res = await tool("account_rotate_key").handler({ id: RUNNING });

			expect(res.isError).toBe(true);
			expect(res.content[0]?.text).toContain("can't update its own env");
			expect(calls.some((c) => c.method === "POST")).toBe(false);
		});

		it("rotate of an id not in the list still POSTs so the API answers 404", async () => {
			const { calls, tool } = setup("sk-sl_run00001secret");
			const unknown = "33333333-cccc-4ccc-8ccc-cccccccccccc";
			await tool("account_rotate_key").handler({ id: unknown });

			expect(calls.at(-1)).toEqual({
				method: "POST",
				path: `/api/keys/${unknown}/rotate`,
				body: {},
			});
		});
	});
});
