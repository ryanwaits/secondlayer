import { highlight } from "@/lib/highlight";
import { templates as workflowTemplates } from "@secondlayer/workflows/templates";
import { tool } from "ai";
import { z } from "zod";

/**
 * Returns the built-in workflow template gallery. Each entry is pre-highlighted
 * server-side so the chat card can render without another round trip.
 */
export const listWorkflowTemplates = tool({
	description:
		"List the built-in workflow templates (whale-alert, mint-watcher, price-circuit-breaker, daily-digest, failed-tx-alert, health-cron). Call this when the user asks what templates are available or says something like 'pick another template'.",
	inputSchema: z.object({}),
	execute: async () => {
		const entries = await Promise.all(
			workflowTemplates.map(async (t) => ({
				id: t.id,
				name: t.name,
				description: t.description,
				category: t.category,
				trigger: t.trigger,
				prompt: t.prompt,
				code: t.code,
				html: await highlight(t.code, "typescript"),
			})),
		);
		return { templates: entries };
	},
});
