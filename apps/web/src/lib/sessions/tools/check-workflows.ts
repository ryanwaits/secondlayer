import { apiRequest } from "@/lib/api";
import type { WorkflowSummary } from "@/lib/types";
import { tool } from "ai";
import { z } from "zod";

export function createCheckWorkflows(sessionToken: string) {
	return tool({
		description:
			"Check the status of the user's workflows. Returns structured data for each workflow including name, status, trigger type, run counts. Set includeRuns=true to fetch recent run history for a specific workflow.",
		inputSchema: z.object({
			name: z
				.string()
				.optional()
				.describe("Specific workflow name to check. Omit to check all."),
			includeRuns: z
				.boolean()
				.default(false)
				.describe(
					"Include recent runs for the workflow (only works with a specific name)",
				),
		}),
		execute: async ({ name, includeRuns }) => {
			const data = await apiRequest<{ workflows: WorkflowSummary[] }>(
				"/api/workflows",
				{ sessionToken },
			);
			const all = data.workflows ?? [];
			const filtered = name ? all.filter((w) => w.name === name) : all;

			const result: Record<string, unknown> = {
				workflows: filtered.map((w) => ({
					name: w.name,
					status: w.status,
					triggerType: w.triggerType,
					totalRuns: w.totalRuns,
					lastRunAt: w.lastRunAt,
				})),
			};

			if (includeRuns && filtered.length === 1) {
				const runs = await apiRequest<{ runs: unknown[] }>(
					`/api/workflows/${filtered[0].name}/runs?limit=5`,
					{ sessionToken },
				).catch(() => ({ runs: [] }));
				result.runs = runs.runs;
			}

			return result;
		},
	});
}
