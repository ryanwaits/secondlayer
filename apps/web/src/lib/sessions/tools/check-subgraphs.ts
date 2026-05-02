import { ApiError } from "@/lib/api";
import { fetchFromTenantOrThrow } from "@/lib/tenant-api";
import type { SubgraphSummary } from "@/lib/types";
import { tool } from "ai";
import { z } from "zod";
import type { AccountInstance } from "./factory";

const NO_INSTANCE_RESULT = {
	subgraphs: [],
	setupRequired: true,
	missing: "instance",
	message:
		"No Secondlayer instance exists for this account yet. Create one from the Billing page or run `sl instance create --plan hobby` before deploying or querying subgraphs.",
	nextActions: [
		"Open `/billing` and create an instance.",
		"Or run `sl instance create --plan hobby` from the CLI after login.",
	],
};

export function createCheckSubgraphs(
	sessionToken: string,
	instance: AccountInstance,
) {
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
			if (instance.exists === false) return NO_INSTANCE_RESULT;

			let data: { data: SubgraphSummary[] };
			try {
				data = await fetchFromTenantOrThrow<{ data: SubgraphSummary[] }>(
					sessionToken,
					"/api/subgraphs",
				);
			} catch (err) {
				if (err instanceof ApiError && err.status === 404) {
					return NO_INSTANCE_RESULT;
				}
				throw err;
			}
			const all = data.data ?? [];
			const filtered = name ? all.filter((s) => s.name === name) : all;

			return {
				subgraphs: filtered.map((s) => ({
					name: s.name,
					status: s.status,
					lastProcessedBlock: s.lastProcessedBlock,
					totalRows: s.totalRows,
					totalErrors: s.totalErrors,
					tables: s.tables,
					resourceWarning: s.resourceWarning,
				})),
			};
		},
	});
}
