import { tool } from "ai";
import { z } from "zod";

/**
 * Tail a subgraph's sync progress. Returns `{ name }`; the card polls
 * `GET /api/subgraphs/:name` and renders a progress bar against
 * `lastProcessedBlock / chainTip`, stopping when the subgraph catches up.
 */
export const tailSubgraphSync = tool({
	description:
		"Tail a subgraph's indexing progress live. Pass the subgraph name. The UI polls GET /api/subgraphs/:name and renders a progress bar until the subgraph catches up to the chain tip. Use this after deploying or reindexing a subgraph, or when the user asks to 'watch' or 'tail' sync progress.",
	inputSchema: z.object({
		name: z.string().describe("Subgraph name"),
	}),
	execute: async ({ name }) => ({ name }),
});
