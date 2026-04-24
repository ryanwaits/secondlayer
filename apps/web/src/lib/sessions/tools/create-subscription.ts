import { tool } from "ai";
import { z } from "zod";

const formatSchema = z.enum([
	"standard-webhooks",
	"inngest",
	"trigger",
	"cloudflare",
	"cloudevents",
	"raw",
]);

const runtimeSchema = z.enum(["inngest", "trigger", "cloudflare", "node"]);

/**
 * Human-in-the-loop subscription creation. The browser performs the POST after
 * user confirmation so the one-time signing secret can be shown in a card.
 */
export const createSubscription = tool({
	description:
		"Create a subgraph table subscription after user confirmation. Use only after checking subgraphs/subscriptions and collecting subgraphName, tableName, runtime, and HTTPS url. Returns a one-time signing secret in the UI.",
	inputSchema: z.object({
		name: z.string().describe("Human-readable subscription name"),
		subgraphName: z.string().describe("Subgraph name"),
		tableName: z.string().describe("Table within the subgraph"),
		url: z.string().describe("HTTPS receiver URL"),
		format: formatSchema
			.optional()
			.describe("Wire format, default standard-webhooks"),
		runtime: runtimeSchema
			.nullable()
			.optional()
			.describe("Receiver runtime label"),
		filter: z
			.record(z.string(), z.unknown())
			.optional()
			.describe("Scalar row filter"),
		reason: z.string().optional().describe("Brief reason shown to the user"),
	}),
});
