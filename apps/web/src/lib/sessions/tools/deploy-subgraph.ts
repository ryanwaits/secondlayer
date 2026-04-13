import { tool } from "ai";
import { z } from "zod";

/**
 * Human-in-the-loop tool — no execute function.
 * The stream stops at `input-available`. The client renders an action card
 * that bundles the source via /api/sessions/bundle-subgraph and, on confirm,
 * POSTs to /api/subgraphs with x-sl-origin: session.
 */
export const deploySubgraph = tool({
	description:
		"Propose deploying a subgraph. Requires user confirmation — the client renders a deploy card with bundle size and a one-line description. Always run scaffold_subgraph (or read_subgraph) first so you're passing the exact TypeScript source the user just saw. Deploy creates or upserts the subgraph definition and triggers a reindex when the schema changes.",
	inputSchema: z.object({
		name: z
			.string()
			.regex(/^[a-z0-9-]+$/)
			.max(63)
			.describe("Subgraph name (lowercase alphanumeric + hyphens)"),
		code: z
			.string()
			.min(1)
			.describe(
				"Full TypeScript source for defineSubgraph(). Must be the same source the user saw in the scaffold / diff card.",
			),
		description: z
			.string()
			.describe(
				"One-line summary for the card (e.g. 'Index dex swaps for pool SP…amm-pool-v2-01').",
			),
		reason: z
			.string()
			.optional()
			.describe("Short reason / user intent — surfaced on the card."),
	}),
});
