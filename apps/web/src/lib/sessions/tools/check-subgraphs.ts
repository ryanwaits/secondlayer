import { apiRequest } from "@/lib/api";
import type { SubgraphSummary } from "@/lib/types";
import { tool } from "ai";
import { z } from "zod";

export function createCheckSubgraphs(sessionToken: string) {
	return tool({
		description:
			"Check the health and status of the user's subgraphs. Returns structured data for each subgraph including name, status, last processed block, and row counts.",
		inputSchema: z.object({
			name: z
				.string()
				.optional()
				.describe("Specific subgraph name to check. Omit to check all."),
		}),
		execute: async ({ name }) => {
			const data = await apiRequest<{ data: SubgraphSummary[] }>(
				"/api/subgraphs",
				{ sessionToken },
			);
			const all = data.data ?? [];
			const filtered = name ? all.filter((s) => s.name === name) : all;

			return {
				subgraphs: filtered.map((s) => ({
					name: s.name,
					status: s.status,
					lastProcessedBlock: s.lastProcessedBlock,
					totalProcessed: s.totalProcessed,
					totalErrors: s.totalErrors,
					tables: s.tables,
				})),
			};
		},
	});
}
