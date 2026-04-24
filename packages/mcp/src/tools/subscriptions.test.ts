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
	it("registers full SDK parity and invokes lifecycle methods", async () => {
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
				pause: async (id: string) => {
					calls.push(`pause:${id}`);
					return { ...subscription, status: "paused" };
				},
				resume: async (id: string) => {
					calls.push(`resume:${id}`);
					return subscription;
				},
				delete: async (id: string) => {
					calls.push(`delete:${id}`);
					return { ok: true };
				},
				rotateSecret: async (id: string) => {
					calls.push(`rotate:${id}`);
					return { subscription, signingSecret: "next-secret" };
				},
				replay: async (id: string) => {
					calls.push(`replay:${id}`);
					return { replayId: "replay-1", enqueuedCount: 1, scannedCount: 1 };
				},
				dead: async (id: string) => {
					calls.push(`dead:${id}`);
					return { data: [{ id: "out-1" }] };
				},
				requeueDead: async (id: string, outboxId: string) => {
					calls.push(`requeue:${id}:${outboxId}`);
					return { ok: true };
				},
				recentDeliveries: async (id: string) => {
					calls.push(`deliveries:${id}`);
					return { data: [{ id: "del-1" }] };
				},
			},
		};

		registerSubscriptionTools(fakeServer(tools), () => client as never);

		expect(tools.map((tool) => tool.name)).toEqual([
			"subscriptions_list",
			"subscriptions_get",
			"subscriptions_create",
			"subscriptions_update",
			"subscriptions_pause",
			"subscriptions_resume",
			"subscriptions_delete",
			"subscriptions_rotate_secret",
			"subscriptions_replay",
			"subscriptions_dead",
			"subscriptions_requeue_dead",
			"subscriptions_recent_deliveries",
		]);

		const byName = Object.fromEntries(
			tools.map((tool) => [tool.name, tool.handler]),
		);
		await byName.subscriptions_pause?.({ id: "sub-1" });
		await byName.subscriptions_resume?.({ id: "sub-1" });
		await byName.subscriptions_rotate_secret?.({ id: "sub-1" });
		await byName.subscriptions_dead?.({ id: "sub-1" });
		await byName.subscriptions_requeue_dead?.({
			id: "sub-1",
			outboxId: "out-1",
		});

		expect(calls).toEqual([
			"pause:sub-1",
			"resume:sub-1",
			"rotate:sub-1",
			"dead:sub-1",
			"requeue:sub-1:out-1",
		]);
	});
});
