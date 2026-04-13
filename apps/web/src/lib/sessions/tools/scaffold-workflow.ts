import { highlight } from "@/lib/highlight";
import { generateWorkflowCode } from "@secondlayer/scaffold";
import { tool } from "ai";
import { z } from "zod";

const TriggerSchema = z.discriminatedUnion("type", [
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
]);

function summariseTrigger(t: z.infer<typeof TriggerSchema>): string {
	switch (t.type) {
		case "event":
		case "stream":
			return t.filterType
				? `${t.type} · ${t.filterType}`
				: `${t.type} trigger`;
		case "schedule":
			return `schedule · ${t.cron}${t.timezone ? ` (${t.timezone})` : ""}`;
		case "manual":
			return "manual trigger";
	}
}

export function createScaffoldWorkflow() {
	return tool({
		description:
			"Generate a compilable defineWorkflow() TypeScript skeleton from a typed intent. Use when the user describes a workflow they want to build (e.g. 'ping Slack when X happens'). Returns the source code for the code-card; the user still has to confirm deploy via deploy_workflow.",
		inputSchema: z.object({
			name: z
				.string()
				.regex(/^[a-z][a-z0-9-]*$/, "lowercase letters, digits, hyphens only")
				.max(63)
				.describe("Workflow name (lowercase kebab-case, e.g. 'whale-alert')"),
			trigger: TriggerSchema.describe("Trigger shape"),
			steps: z
				.array(z.enum(["run", "query", "ai", "deliver"]))
				.min(1)
				.describe(
					"Ordered list of step kinds to render in the handler. 'deliver' must be paired with deliveryTarget.",
				),
			deliveryTarget: z
				.enum(["webhook", "slack", "email", "discord", "telegram"])
				.optional()
				.describe("Delivery channel used when steps includes 'deliver'"),
		}),
		execute: async ({ name, trigger, steps, deliveryTarget }) => {
			const code = generateWorkflowCode({
				name,
				trigger,
				steps,
				deliveryTarget,
			});
			const html = await highlight(code, "typescript");
			return {
				code,
				html,
				name,
				triggerSummary: summariseTrigger(trigger),
				filename: `workflows/${name}.ts`,
			};
		},
	});
}
