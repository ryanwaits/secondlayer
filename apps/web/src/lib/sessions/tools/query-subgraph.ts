import { apiRequest } from "@/lib/api";
import { tool } from "ai";
import { z } from "zod";

export function createQuerySubgraph(sessionToken: string) {
	return tool({
		description:
			"Query data from a subgraph table. Returns rows with pagination. Use when the user wants to see actual data from their subgraph tables.",
		inputSchema: z.object({
			subgraphName: z.string().describe("Name of the subgraph"),
			tableName: z.string().describe("Name of the table to query"),
			limit: z.number().default(10).describe("Number of rows to return"),
			sort: z.string().optional().describe("Column to sort by"),
			order: z
				.enum(["asc", "desc"])
				.default("desc")
				.describe("Sort order"),
		}),
		execute: async ({ subgraphName, tableName, limit, sort, order }) => {
			const params = new URLSearchParams({
				_limit: String(limit),
				_sort: sort ?? "_id",
				_order: order,
			});
			const data = await apiRequest<{ data: unknown[]; meta?: unknown }>(
				`/api/subgraphs/${subgraphName}/${tableName}?${params}`,
				{ sessionToken },
			);
			return {
				subgraph: subgraphName,
				table: tableName,
				rows: data.data ?? [],
				meta: data.meta,
			};
		},
	});
}
