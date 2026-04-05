import { apiRequest } from "@/lib/api";
import type { ApiKey } from "@/lib/types";
import { tool } from "ai";
import { z } from "zod";

export function createCheckKeys(sessionToken: string) {
	return tool({
		description:
			"List the user's active API keys. Returns a UI card showing key names, prefixes, and last-used dates. Always call this before managing keys so the user can see their current keys.",
		inputSchema: z.object({}),
		execute: async () => {
			const data = await apiRequest<{ keys: ApiKey[] }>("/api/keys", {
				sessionToken,
			});
			return {
				keys: (data.keys ?? [])
					.filter((k) => k.status === "active")
					.map((k) => ({
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
