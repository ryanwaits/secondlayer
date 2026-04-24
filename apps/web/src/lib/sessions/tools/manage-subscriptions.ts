import { tool } from "ai";
import { z } from "zod";

export const manageSubscriptions = tool({
	description:
		"Pause, resume, delete, rotate-secret, or replay subscriptions after user confirmation. Use for lifecycle operations; never perform these in text.",
	inputSchema: z.object({
		action: z
			.enum(["pause", "resume", "delete", "rotate-secret", "replay"])
			.describe("Lifecycle action"),
		targets: z
			.array(
				z.object({
					id: z.string().describe("Subscription id"),
					name: z.string().describe("Subscription display name"),
					reason: z.string().optional(),
					fromBlock: z
						.number()
						.int()
						.nonnegative()
						.optional()
						.describe("Replay start block, required for replay"),
					toBlock: z
						.number()
						.int()
						.nonnegative()
						.optional()
						.describe("Replay end block, required for replay"),
				}),
			)
			.describe("Subscriptions to act on"),
	}),
});
