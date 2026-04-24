import { tool } from "ai";
import { z } from "zod";

export const requeueDeadSubscription = tool({
	description:
		"Requeue one dead-letter outbox row after user confirmation. Use only for a specific outbox row id after diagnosis.",
	inputSchema: z.object({
		subscriptionId: z.string().describe("Subscription id"),
		subscriptionName: z.string().describe("Subscription display name"),
		outboxId: z.string().describe("Dead-letter outbox row id to requeue"),
		reason: z.string().optional().describe("Brief reason shown to the user"),
	}),
});
