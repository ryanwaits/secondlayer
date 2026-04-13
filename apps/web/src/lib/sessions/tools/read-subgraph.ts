import { apiRequest } from "@/lib/api";
import { highlight } from "@/lib/highlight";
import { tool } from "ai";
import { z } from "zod";

interface SubgraphSourceResponse {
	name: string;
	version: string;
	sourceCode: string | null;
	readOnly: boolean;
	reason?: string;
	updatedAt: string;
}

export function createReadSubgraph(sessionToken: string) {
	return tool({
		description:
			"Fetch the deployed TypeScript source of a subgraph, plus its stored version. ALWAYS call this before edit_subgraph so you pass the exact source the user will see in the diff. Returns `{ readOnly: true, reason }` for subgraphs deployed before source capture — in that case tell the user to redeploy via CLI before editing from chat.",
		inputSchema: z.object({
			name: z.string().describe("Subgraph name"),
		}),
		execute: async ({ name }) => {
			try {
				const data = await apiRequest<SubgraphSourceResponse>(
					`/api/subgraphs/${name}/source`,
					{ sessionToken },
				);
				if (data.sourceCode === null) {
					return {
						name: data.name,
						version: data.version,
						readOnly: true,
						reason:
							data.reason ??
							"deployed before source-capture — redeploy to enable chat edits",
						updatedAt: data.updatedAt,
					};
				}
				const html = await highlight(data.sourceCode, "typescript");
				return {
					name: data.name,
					version: data.version,
					readOnly: false,
					sourceCode: data.sourceCode,
					html,
					filename: `subgraphs/${data.name}.ts`,
					updatedAt: data.updatedAt,
				};
			} catch (err) {
				return {
					error: true,
					message: err instanceof Error ? err.message : String(err),
				};
			}
		},
	});
}
