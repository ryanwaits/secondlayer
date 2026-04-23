import { tool } from "ai";
import { z } from "zod";

/**
 * Human-in-the-loop edit tool — no execute function.
 * The client fetches a server-rendered diff and shows it on the action card.
 * Confirming triggers the same bundle → deploy path as deploy_subgraph.
 *
 * Note: subgraphs don't currently support `expectedVersion` stale-write
 * protection; concurrent dashboard edits could race. Instruct agents to
 * read_subgraph immediately before proposing an edit.
 */
export const editSubgraph = tool({
	description:
		"Propose an edit to a deployed subgraph. Requires user confirmation via a diff card. ALWAYS call read_subgraph first to get the current source — then pass that exact source as currentCode and your modified version as proposedCode. Breaking schema changes trigger an automatic reindex on the server; warn the user when you confirm if the edit touches schema columns or sources.",
	inputSchema: z.object({
		name: z
			.string()
			.regex(/^[a-z0-9-]+$/)
			.max(63)
			.describe("Subgraph name being edited"),
		currentCode: z
			.string()
			.min(1)
			.describe(
				"Source as fetched from read_subgraph — used to render the diff.",
			),
		proposedCode: z
			.string()
			.min(1)
			.describe(
				"Proposed new source. Must compile + validate — the confirm path re-bundles before persisting.",
			),
		summary: z
			.string()
			.min(1)
			.describe("One-line summary of the change for the diff card."),
	}),
});
