import { describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSubscriptionTools } from "./subscriptions.ts";

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

describe("subscription MCP tools", () => {
	it("registers the golden-path lifecycle and invokes SDK methods", async () => {
		const tools: RegisteredTool[] = [];
		const calls: string[] = [];
		const subscription = {
			id: "sub-1",
			name: "whale-alerts",
			status: "active",
		};
		const client = {
			subscriptions: {
				list: async () => ({ data: [subscription] }),
				get: async (id: string) => {
					calls.push(`get:${id}`);
					return subscription;
				},
				create: async () => ({ subscription, signingSecret: "secret" }),
				update: async (id: string) => {
					calls.push(`update:${id}`);
					return subscription;
				},
				delete: async (id: string) => {
					calls.push(`delete:${id}`);
					return { ok: true };
				},
				test: async (id: string) => {
					calls.push(`test:${id}`);
					return { ok: true, statusCode: 200 };
				},
				replay: async (id: string) => {
					calls.push(`replay:${id}`);
					return { replayId: "replay-1", enqueuedCount: 1, scannedCount: 1 };
				},
			},
		};

		registerSubscriptionTools(fakeServer(tools), () => client as never);

		expect(tools.map((tool) => tool.name)).toEqual([
			"subscriptions_list",
			"subscriptions_get",
			"subscriptions_create",
			"subscriptions_update",
			"subscriptions_delete",
			"subscriptions_test",
			"subscriptions_replay",
		]);

		const byName = Object.fromEntries(
			tools.map((tool) => [tool.name, tool.handler]),
		);
		await byName.subscriptions_get?.({ id: "sub-1" });
		await byName.subscriptions_test?.({ id: "sub-1" });
		await byName.subscriptions_delete?.({ id: "sub-1" });

		expect(calls).toEqual(["get:sub-1", "test:sub-1", "delete:sub-1"]);
	});

	it("forwards authConfig, name (rename), and replay force", async () => {
		const tools: RegisteredTool[] = [];
		let created: Record<string, unknown> | undefined;
		let updated: { id: string; patch: Record<string, unknown> } | undefined;
		let replayed: { id: string; range: Record<string, unknown> } | undefined;
		const client = {
			subscriptions: {
				create: async (input: Record<string, unknown>) => {
					created = input;
					return { subscription: { id: "s1" }, signingSecret: "x" };
				},
				update: async (id: string, patch: Record<string, unknown>) => {
					updated = { id, patch };
					return { id };
				},
				replay: async (id: string, range: Record<string, unknown>) => {
					replayed = { id, range };
					return { replayId: "r1", enqueuedCount: 0, scannedCount: 0 };
				},
			},
		};
		registerSubscriptionTools(fakeServer(tools), () => client as never);
		const byName = Object.fromEntries(
			tools.map((tool) => [tool.name, tool.handler]),
		);

		await byName.subscriptions_create?.({
			name: "hook",
			url: "https://e.x/h",
			authConfig: { type: "bearer", token: "t" },
		});
		expect(created?.authConfig).toEqual({ type: "bearer", token: "t" });

		await byName.subscriptions_update?.({
			id: "s1",
			name: "renamed",
			authConfig: { type: "bearer", token: "t2" },
		});
		expect(updated).toEqual({
			id: "s1",
			patch: { name: "renamed", authConfig: { type: "bearer", token: "t2" } },
		});

		await byName.subscriptions_replay?.({
			id: "s1",
			fromBlock: 1,
			toBlock: 2,
			force: "redo",
		});
		expect(replayed).toEqual({
			id: "s1",
			range: { fromBlock: 1, toBlock: 2, force: "redo" },
		});
	});
});
