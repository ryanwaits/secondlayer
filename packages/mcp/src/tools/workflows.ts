import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { getClient } from "../lib/client.ts";
import { defineTool } from "../lib/tool.ts";

export function registerWorkflowTools(server: McpServer) {
	defineTool<Record<string, never>>(
		server,
		"workflows_list",
		"List all workflows. Returns summary fields only.",
		{},
		async () => {
			const { workflows } = await getClient().workflows.list();
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(workflows, null, 2),
					},
				],
			};
		},
	);

	defineTool<{ name: string }>(
		server,
		"workflows_get",
		"Get full details of a workflow by name.",
		{ name: z.string().describe("Workflow name") },
		async ({ name }) => {
			const detail = await getClient().workflows.get(name);
			return {
				content: [{ type: "text", text: JSON.stringify(detail, null, 2) }],
			};
		},
	);

	defineTool<{ name: string; input?: string }>(
		server,
		"workflows_trigger",
		"Trigger a workflow run. Optionally pass input as a JSON string.",
		{
			name: z.string().describe("Workflow name"),
			input: z
				.string()
				.optional()
				.describe("Input as JSON string"),
		},
		async ({ name, input }) => {
			const parsed = input ? JSON.parse(input) : undefined;
			const result = await getClient().workflows.trigger(name, parsed);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	defineTool<{ name: string }>(
		server,
		"workflows_pause",
		"Pause a running workflow.",
		{ name: z.string().describe("Workflow name") },
		async ({ name }) => {
			await getClient().workflows.pause(name);
			return {
				content: [{ type: "text", text: `Paused workflow "${name}"` }],
			};
		},
	);

	defineTool<{ name: string }>(
		server,
		"workflows_resume",
		"Resume a paused workflow.",
		{ name: z.string().describe("Workflow name") },
		async ({ name }) => {
			await getClient().workflows.resume(name);
			return {
				content: [{ type: "text", text: `Resumed workflow "${name}"` }],
			};
		},
	);

	defineTool<{ name: string; status?: string; limit?: number }>(
		server,
		"workflows_runs",
		"List runs for a workflow. Optionally filter by status and limit results.",
		{
			name: z.string().describe("Workflow name"),
			status: z
				.enum(["running", "completed", "failed", "cancelled"])
				.optional()
				.describe("Filter by run status"),
			limit: z
				.number()
				.optional()
				.describe("Max runs to return (default 20)"),
		},
		async ({ name, status, limit }) => {
			const { runs } = await getClient().workflows.listRuns(name, {
				status: status as "running" | "completed" | "failed" | "cancelled" | undefined,
				limit,
			});
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(runs, null, 2),
					},
				],
			};
		},
	);
}
