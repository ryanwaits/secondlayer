import { describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWebhookTools } from "./webhooks.ts";

interface RegisteredTool {
	name: string;
	description: string;
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
			_schema: Record<string, unknown>,
			handler: RegisteredTool["handler"],
		) => {
			tools.push({ name, description, handler });
		},
	} as unknown as McpServer;
}

describe("webhook MCP tools", () => {
	it("registers the golden-path lifecycle and invokes SDK methods", async () => {
		const tools: RegisteredTool[] = [];
		const calls: string[] = [];
		const webhook = {
			id: "sub-1",
			name: "whale-alerts",
			status: "active",
		};
		const client = {
			webhooks: {
				list: async () => ({ data: [webhook] }),
				get: async (id: string) => {
					calls.push(`get:${id}`);
					return webhook;
				},
				create: async () => ({ webhook, signingSecret: "secret" }),
				update: async (id: string) => {
					calls.push(`update:${id}`);
					return webhook;
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

		registerWebhookTools(fakeServer(tools), () => client as never);

		expect(tools.map((tool) => tool.name)).toEqual([
			"webhooks_list",
			"webhooks_get",
			"webhooks_create",
			"webhooks_update",
			"webhooks_delete",
			"webhooks_test",
			"webhooks_pause",
			"webhooks_resume",
			"webhooks_rotate_secret",
			"webhooks_deliveries",
			"webhooks_dead",
			"webhooks_requeue",
			"webhooks_replay",
		]);

		const byName = Object.fromEntries(
			tools.map((tool) => [tool.name, tool.handler]),
		);
		await byName.webhooks_get?.({ id: "sub-1" });
		await byName.webhooks_test?.({ id: "sub-1" });
		await byName.webhooks_delete?.({ id: "sub-1" });

		expect(calls).toEqual(["get:sub-1", "test:sub-1", "delete:sub-1"]);
	});

	it("pauses, resumes, and rotates the signing secret for one webhook", async () => {
		const tools: RegisteredTool[] = [];
		const calls: string[] = [];
		const client = {
			webhooks: {
				pause: async (id: string) => {
					calls.push(`pause:${id}`);
					return { id, status: "paused" };
				},
				resume: async (id: string) => {
					calls.push(`resume:${id}`);
					return { id, status: "active" };
				},
				rotateSecret: async (id: string) => {
					calls.push(`rotate:${id}`);
					return { signingSecret: "whsec_new" };
				},
			},
		};
		registerWebhookTools(fakeServer(tools), () => client as never);
		const byName = Object.fromEntries(
			tools.map((tool) => [tool.name, tool.handler]),
		);

		const paused = await byName.webhooks_pause?.({ id: "sub-1" });
		const resumed = await byName.webhooks_resume?.({ id: "sub-1" });
		const rotated = await byName.webhooks_rotate_secret?.({ id: "sub-1" });

		expect(calls).toEqual(["pause:sub-1", "resume:sub-1", "rotate:sub-1"]);
		expect(paused?.content[0]?.text).toContain('"status": "paused"');
		expect(resumed?.content[0]?.text).toContain('"status": "active"');
		expect(rotated?.content[0]?.text).toContain("whsec_new");
	});

	it("reads deliveries and the dead-letter queue, then requeues one dead row", async () => {
		const tools: RegisteredTool[] = [];
		const calls: string[] = [];
		const client = {
			webhooks: {
				deliveries: async (id: string) => {
					calls.push(`deliveries:${id}`);
					return { data: [{ id: "d1", statusCode: 200, attempt: 1 }] };
				},
				dead: async (id: string) => {
					calls.push(`dead:${id}`);
					return { data: [{ outboxId: "ob-1", lastError: "timeout" }] };
				},
				requeue: async (id: string, outboxId: string) => {
					calls.push(`requeue:${id}:${outboxId}`);
					return { ok: true };
				},
			},
		};
		registerWebhookTools(fakeServer(tools), () => client as never);
		const byName = Object.fromEntries(
			tools.map((tool) => [tool.name, tool.handler]),
		);

		const deliveries = await byName.webhooks_deliveries?.({ id: "sub-1" });
		const dead = await byName.webhooks_dead?.({ id: "sub-1" });
		const requeued = await byName.webhooks_requeue?.({
			id: "sub-1",
			outboxId: "ob-1",
		});

		expect(calls).toEqual([
			"deliveries:sub-1",
			"dead:sub-1",
			"requeue:sub-1:ob-1",
		]);
		expect(deliveries?.content[0]?.text).toContain('"statusCode": 200');
		expect(dead?.content[0]?.text).toContain("timeout");
		expect(requeued?.content[0]?.text).toContain('"ok": true');
	});

	it("forwards authConfig, name (rename), and replay force", async () => {
		const tools: RegisteredTool[] = [];
		let created: Record<string, unknown> | undefined;
		let updated: { id: string; patch: Record<string, unknown> } | undefined;
		let replayed: { id: string; range: Record<string, unknown> } | undefined;
		const client = {
			webhooks: {
				create: async (input: Record<string, unknown>) => {
					created = input;
					return { webhook: { id: "s1" }, signingSecret: "x" };
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
		registerWebhookTools(fakeServer(tools), () => client as never);
		const byName = Object.fromEntries(
			tools.map((tool) => [tool.name, tool.handler]),
		);

		await byName.webhooks_create?.({
			name: "hook",
			url: "https://e.x/h",
			authConfig: { type: "bearer", token: "t" },
		});
		expect(created?.authConfig).toEqual({ type: "bearer", token: "t" });

		await byName.webhooks_update?.({
			id: "s1",
			name: "renamed",
			authConfig: { type: "bearer", token: "t2" },
		});
		expect(updated).toEqual({
			id: "s1",
			patch: { name: "renamed", authConfig: { type: "bearer", token: "t2" } },
		});

		await byName.webhooks_replay?.({
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
