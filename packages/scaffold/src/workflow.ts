/**
 * Browser-safe workflow scaffold generator.
 *
 * Emits compilable `defineWorkflow()` source from a typed intent. The output
 * is deliberately minimal — agents or humans are expected to fill in the
 * placeholders (filter criteria, AI prompt, delivery body).
 */

export type ScaffoldStepKind = "run" | "query" | "ai" | "deliver";
export type ScaffoldDeliveryTarget =
	| "webhook"
	| "slack"
	| "email"
	| "discord"
	| "telegram";

export type ScaffoldTriggerInput =
	| { type: "event"; filterType?: string }
	| { type: "schedule"; cron: string; timezone?: string }
	| { type: "manual" };

export interface GenerateWorkflowCodeInput {
	name: string;
	trigger: ScaffoldTriggerInput;
	steps: readonly ScaffoldStepKind[];
	deliveryTarget?: ScaffoldDeliveryTarget;
}

function renderTrigger(trigger: ScaffoldTriggerInput): string {
	switch (trigger.type) {
		case "event":
			return `{
		type: "event",
		filter: {
			type: "${trigger.filterType ?? "stx_transfer"}",
			// Add filter criteria below (e.g. minAmount, sender, recipient).
		},
	}`;
		case "schedule":
			return `{
		type: "schedule",
		cron: "${trigger.cron}",${trigger.timezone ? `\n\t\ttimezone: "${trigger.timezone}",` : ""}
	}`;
		case "manual":
			return `{
		type: "manual",
	}`;
	}
}

function renderDeliverTarget(target: ScaffoldDeliveryTarget): string {
	switch (target) {
		case "webhook":
			return `{
				type: "webhook",
				url: "https://example.com/webhook",
				body: { summary: String(analysis.summary ?? "") },
			}`;
		case "slack":
			return `{
				type: "slack",
				channel: "#alerts",
				text: String(analysis.summary ?? ""),
			}`;
		case "email":
			return `{
				type: "email",
				to: "you@example.com",
				subject: "Workflow alert",
				body: String(analysis.summary ?? ""),
			}`;
		case "discord":
			return `{
				type: "discord",
				webhookUrl: "https://discord.com/api/webhooks/...",
				content: String(analysis.summary ?? ""),
			}`;
		case "telegram":
			return `{
				type: "telegram",
				botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
				chatId: "",
				text: String(analysis.summary ?? ""),
			}`;
	}
}

function renderSteps(
	steps: readonly ScaffoldStepKind[],
	deliveryTarget: ScaffoldDeliveryTarget | undefined,
): string {
	const lines: string[] = [];
	let needsAnalysisBinding = false;
	for (const step of steps) {
		switch (step) {
			case "run":
				lines.push(
					`		await ctx.step.run("fetch-context", async () => {\n` +
						"			// TODO: fetch supporting data, enrich the event, etc.\n" +
						"			return {};\n" +
						"		});",
				);
				break;
			case "query":
				lines.push(
					`		const rows = await ctx.step.query("recent-activity", "my-subgraph", "transfers", {\n` +
						"			limit: 10,\n" +
						`			orderBy: { created_at: "desc" },\n` +
						"		});\n" +
						"		void rows;",
				);
				break;
			case "ai": {
				needsAnalysisBinding = true;
				lines.push(
					`		const analysis = await ctx.step.ai("analyze", {\n` +
						`			model: "sonnet",\n` +
						`			prompt: "Summarize the event for a human operator.",\n` +
						"			schema: {\n" +
						`				summary: { type: "string" },\n` +
						"			},\n" +
						"		});",
				);
				break;
			}
			case "deliver": {
				const target = deliveryTarget ?? "webhook";
				if (!needsAnalysisBinding) {
					lines.push("		const analysis: { summary?: unknown } = {};");
					needsAnalysisBinding = true;
				}
				lines.push(
					`		await ctx.step.deliver("notify", ${renderDeliverTarget(target)});`,
				);
				break;
			}
		}
	}
	return lines.join("\n\n");
}

export function generateWorkflowCode(input: GenerateWorkflowCodeInput): string {
	const body = renderSteps(input.steps, input.deliveryTarget);
	const handlerBody =
		body.length > 0 ? body : "		// TODO: add steps\n		void ctx;";

	return `import { defineWorkflow } from "@secondlayer/workflows";

export default defineWorkflow({
	name: "${input.name}",
	trigger: ${renderTrigger(input.trigger)},
	handler: async (ctx) => {
${handlerBody}
	},
});
`;
}
