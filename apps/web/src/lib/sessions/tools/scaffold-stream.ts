import { highlight } from "@/lib/highlight";
import {
	type CreateStream,
	type StreamFilter,
	generateStreamConfig,
} from "@secondlayer/scaffold";
import { tool } from "ai";
import { z } from "zod";

/**
 * Assembles a fully-shaped CreateStream config from a minimal intent. Unlike
 * workflows/subgraphs, this returns JSON, not TypeScript source — the deploy
 * card POSTs the object directly to /api/streams. We surface the pretty-
 * printed config to the user in a dedicated card so filters are readable.
 *
 * We accept `filters` as `unknown[]` from the tool layer (the discriminated
 * union is awkward to express in zod v3 without losing the type narrowing
 * we want), then cast inside generateStreamConfig. The scaffold helper
 * validates the shape; the server revalidates on deploy.
 */
export const scaffoldStream = tool({
	description:
		"Generate a stream config (JSON) from an intent. Streams are NOT TypeScript — they're structured filter arrays that fire HTTP deliveries when matching blockchain events happen. Pass a name, the HTTPS endpoint the user wants to POST to, and one or more filter objects. If unsure which filter type fits the user's request, call list_stream_filter_types first. Returns the full CreateStream payload the deploy tool will use.",
	inputSchema: z.object({
		name: z.string().min(1).max(255).describe("Stream display name"),
		endpointUrl: z
			.string()
			.url()
			.describe("HTTPS URL the stream will POST deliveries to"),
		filters: z
			.array(z.record(z.string(), z.unknown()))
			.min(1)
			.describe(
				"Array of filter objects. Each must have a `type` discriminator (e.g. stx_transfer, ft_transfer, nft_mint, contract_call, print_event) plus any optional params for that type. Call list_stream_filter_types for the full catalogue.",
			),
		options: z
			.record(z.string(), z.unknown())
			.optional()
			.describe(
				"Optional delivery options: decodeClarityValues, includeRawTx, includeBlockMetadata, rateLimit (1-100), timeoutMs (≤30000), maxRetries (0-10).",
			),
	}),
	execute: async ({ name, endpointUrl, filters, options }) => {
		try {
			const config = generateStreamConfig({
				name,
				endpointUrl,
				filters: filters as StreamFilter[],
				options: options as Partial<CreateStream["options"]>,
			});
			const configJson = JSON.stringify(config, null, 2);
			const html = await highlight(configJson, "json");
			return {
				name: config.name,
				endpointUrl: config.endpointUrl,
				filters: config.filters,
				options: config.options,
				configJson,
				html,
			};
		} catch (err) {
			return {
				error: true,
				message: err instanceof Error ? err.message : String(err),
			};
		}
	},
});
