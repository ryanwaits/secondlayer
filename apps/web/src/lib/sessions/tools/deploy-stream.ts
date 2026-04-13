import { tool } from "ai";
import { z } from "zod";

/**
 * Human-in-the-loop tool — no execute function.
 * The client renders a DeployStreamCard that POSTs the full config to
 * /api/streams on confirm. The response includes a one-time signingSecret
 * that the card surfaces prominently — it's never retrievable again.
 */
export const deployStream = tool({
	description:
		"Propose creating a new stream. Requires user confirmation — the client renders a deploy card with the endpoint + filter list + delivery options. Always call scaffold_stream first to produce a validated config. Pass the full filters array and options object as returned by scaffold_stream. On confirm, the signing secret is shown ONCE in the success card — tell the user to copy it immediately.",
	inputSchema: z.object({
		name: z.string().min(1).max(255).describe("Stream display name"),
		endpointUrl: z
			.string()
			.url()
			.describe("HTTPS URL the stream will POST deliveries to"),
		filters: z
			.array(z.record(z.string(), z.unknown()))
			.min(1)
			.describe("Filter array from scaffold_stream output"),
		options: z
			.record(z.string(), z.unknown())
			.optional()
			.describe("Delivery options from scaffold_stream output"),
		reason: z
			.string()
			.optional()
			.describe("Short reason / user intent — surfaced on the card."),
	}),
});
