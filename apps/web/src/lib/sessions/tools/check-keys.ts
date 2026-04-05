import { apiRequest } from "@/lib/api";
import type { ApiKey } from "@/lib/types";
import { tool } from "ai";
import { z } from "zod";

export function createCheckKeys(sessionToken: string) {
	return tool({
		description:
			"List the user's API keys with their names, prefixes, status, and last used dates.",
		inputSchema: z.object({}),
		execute: async () => {
			const data = await apiRequest<{ keys: ApiKey[] }>("/api/keys", {
				sessionToken,
			});
			return {
				keys: (data.keys ?? []).map((k) => ({
					id: k.id,
					name: k.name,
					prefix: k.prefix,
					status: k.status,
					lastUsedAt: k.lastUsedAt,
					createdAt: k.createdAt,
				})),
			};
		},
	});
}
