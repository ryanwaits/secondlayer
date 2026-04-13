import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bundleWorkflowCode } from "@secondlayer/bundler";
import {
	type ScaffoldDeliveryTarget,
	type ScaffoldStepKind,
	generateWorkflowCode,
} from "@secondlayer/scaffold";
import { VersionConflictError } from "@secondlayer/sdk";
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

	defineTool<{ name: string }>(
		server,
		"workflows_get_definition",
		"Return the deployed TypeScript source of a workflow plus its stored version. Returns `sourceCode: null` + `readOnly: true` for workflows deployed before source capture.",
		{ name: z.string().describe("Workflow name") },
		async ({ name }) => {
			const source = await getClient().workflows.getSource(name);
			return {
				content: [{ type: "text", text: JSON.stringify(source, null, 2) }],
			};
		},
	);

	defineTool<{ name: string }>(
		server,
		"workflows_delete",
		"Delete a workflow permanently.",
		{ name: z.string().describe("Workflow name") },
		async ({ name }) => {
			await getClient().workflows.delete(name);
			return {
				content: [{ type: "text", text: `Deleted workflow "${name}"` }],
			};
		},
	);

	defineTool<{ name: string; input?: string }>(
		server,
		"workflows_trigger",
		"Trigger a workflow run. Optionally pass input as a JSON string.",
		{
			name: z.string().describe("Workflow name"),
			input: z.string().optional().describe("Input as JSON string"),
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

	defineTool<{
		name: string;
		trigger:
			| { type: "event"; filterType?: string }
			| { type: "stream"; filterType?: string }
			| { type: "schedule"; cron: string; timezone?: string }
			| { type: "manual" };
		steps: ScaffoldStepKind[];
		deliveryTarget?: ScaffoldDeliveryTarget;
	}>(
		server,
		"workflows_scaffold",
		"Generate a compilable defineWorkflow() skeleton from a typed intent. Returns the TypeScript source; pass it to workflows_deploy to persist. Placeholders inside the source must be filled in before running a real workflow.",
		{
			name: z
				.string()
				.regex(/^[a-z][a-z0-9-]*$/)
				.describe("Workflow name (lowercase, hyphens)"),
			trigger: z
				.discriminatedUnion("type", [
					z.object({
						type: z.literal("event"),
						filterType: z.string().optional(),
					}),
					z.object({
						type: z.literal("stream"),
						filterType: z.string().optional(),
					}),
					z.object({
						type: z.literal("schedule"),
						cron: z.string().min(1),
						timezone: z.string().optional(),
					}),
					z.object({ type: z.literal("manual") }),
				])
				.describe("Trigger shape"),
			steps: z
				.array(z.enum(["run", "query", "ai", "deliver"]))
				.describe("Ordered list of step kinds to include in the handler"),
			deliveryTarget: z
				.enum(["webhook", "slack", "email", "discord", "telegram"])
				.optional()
				.describe("Delivery target used when steps includes `deliver`"),
		},
		async ({ name, trigger, steps, deliveryTarget }) => {
			const code = generateWorkflowCode({
				name,
				trigger,
				steps,
				deliveryTarget,
			});
			return { content: [{ type: "text", text: code }] };
		},
	);

	defineTool<{ code: string; expectedVersion?: string; dryRun?: boolean }>(
		server,
		"workflows_deploy",
		"Deploy a workflow from TypeScript source. Pass the full defineWorkflow() source — it will be bundled, validated, and deployed. Use expectedVersion for optimistic concurrency, or dryRun to validate without persisting.",
		{
			code: z
				.string()
				.describe("TypeScript source code containing a defineWorkflow() call"),
			expectedVersion: z
				.string()
				.regex(/^\d+\.\d+\.\d+$/)
				.optional()
				.describe(
					"Stored version the client expects (major.minor.patch). Server returns 409 on mismatch.",
				),
			dryRun: z
				.boolean()
				.optional()
				.describe("If true, validate and bundle only — do not persist."),
		},
		async ({ code, expectedVersion, dryRun }) => {
			let bundled: Awaited<ReturnType<typeof bundleWorkflowCode>>;
			try {
				bundled = await bundleWorkflowCode(code);
			} catch (err) {
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: err instanceof Error ? err.message : String(err),
						},
					],
				};
			}

			const base = {
				name: bundled.name,
				trigger: bundled.trigger as unknown as Record<string, unknown>,
				handlerCode: bundled.handlerCode,
				sourceCode: bundled.sourceCode,
				retries: bundled.retries as Record<string, unknown> | undefined,
				timeout: bundled.timeout,
				expectedVersion,
			};
			try {
				const result = dryRun
					? await getClient().workflows.deploy({ ...base, dryRun: true })
					: await getClient().workflows.deploy(base);
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (err) {
				if (err instanceof VersionConflictError) {
					return {
						isError: true,
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										error: err.message,
										code: "VERSION_CONFLICT",
										currentVersion: err.currentVersion,
										expectedVersion: err.expectedVersion,
									},
									null,
									2,
								),
							},
						],
					};
				}
				throw err;
			}
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
			limit: z.number().optional().describe("Max runs to return (default 20)"),
		},
		async ({ name, status, limit }) => {
			const { runs } = await getClient().workflows.listRuns(name, {
				status: status as
					| "running"
					| "completed"
					| "failed"
					| "cancelled"
					| undefined,
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
