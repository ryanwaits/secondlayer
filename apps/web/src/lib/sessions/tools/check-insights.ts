import { apiRequest } from "@/lib/api";
import type { AccountInsight } from "@/lib/types";
import { tool } from "ai";
import { z } from "zod";

export function createCheckInsights(sessionToken: string) {
	return tool({
		description:
			"Check account insights and alerts — warnings, recommendations, and issues detected by the platform.",
		inputSchema: z.object({}),
		execute: async () => {
			const data = await apiRequest<{ insights: AccountInsight[] }>(
				"/api/insights",
				{ sessionToken },
			);
			return {
				insights: (data.insights ?? []).map((i) => ({
					id: i.id,
					severity: i.severity,
					title: i.title,
					body: i.body,
					category: i.category,
					resourceId: i.resourceId,
					createdAt: i.createdAt,
				})),
			};
		},
	});
}
