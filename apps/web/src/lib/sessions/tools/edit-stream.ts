import { tool } from "ai";
import { z } from "zod";

/**
 * Human-in-the-loop edit tool — no execute function.
 * Renders a ConfigDiffCard (filters added/removed/changed, options changed)
 * and PATCHes /api/streams/:id on confirm.
 */
export const editStream = tool({
	description:
		"Propose an edit to a deployed stream (filters, options, endpoint, or name). Requires user confirmation via a config diff card. ALWAYS call read_stream first to get the current config — then pass that exact config object as currentConfig and your modified version as proposedConfig. Only include fields you actually want to change in proposedConfig; omitted fields are left alone on the server. Use this for: swapping a filter, raising rate limits, rotating the endpoint URL.",
	inputSchema: z.object({
		id: z.string().describe("Stream UUID from read_stream"),
		currentConfig: z
			.object({
				name: z.string(),
				endpointUrl: z.string(),
				filters: z.array(z.record(z.string(), z.unknown())),
				options: z.record(z.string(), z.unknown()),
			})
			.describe("The config as returned by read_stream (verbatim)."),
		proposedConfig: z
			.object({
				name: z.string().optional(),
				endpointUrl: z.string().url().optional(),
				filters: z.array(z.record(z.string(), z.unknown())).optional(),
				options: z.record(z.string(), z.unknown()).optional(),
			})
			.describe("Only include fields you want to change."),
		summary: z
			.string()
			.min(1)
			.describe("One-line summary of the change for the diff card."),
	}),
});
