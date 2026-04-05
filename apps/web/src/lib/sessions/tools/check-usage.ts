import { apiRequest } from "@/lib/api";
import { tool } from "ai";
import { z } from "zod";

export function createCheckUsage(sessionToken: string) {
	return tool({
		description:
			"Check the user's account usage and activity statistics — API request counts, delivery counts, storage usage, and plan limits.",
		inputSchema: z.object({}),
		execute: async () => {
			const data = await apiRequest<Record<string, unknown>>(
				"/api/accounts/usage",
				{ sessionToken },
			);
			return data;
		},
	});
}
