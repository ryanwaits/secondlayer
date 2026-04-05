import { apiRequest } from "@/lib/api";
import type { Stream } from "@/lib/types";
import { tool } from "ai";
import { z } from "zod";

export function createCheckStreams(sessionToken: string) {
	return tool({
		description:
			"Check the health and status of the user's webhook streams. Returns structured data for each stream including name, status, delivery counts, and errors. Set includeDeliveries=true to fetch recent delivery history for a specific stream.",
		inputSchema: z.object({
			name: z
				.string()
				.optional()
				.describe("Specific stream name to check. Omit to check all."),
			includeDeliveries: z
				.boolean()
				.default(false)
				.describe("Include recent deliveries for the stream (only works with a specific name)"),
		}),
		execute: async ({ name, includeDeliveries }) => {
			const data = await apiRequest<{ streams: Stream[] }>(
				"/api/streams?limit=100&offset=0",
				{ sessionToken },
			);
			const all = data.streams ?? [];
			const filtered = name
				? all.filter((s) => s.name === name)
				: all;

			const result: Record<string, unknown> = {
				streams: filtered.map((s) => ({
					id: s.id,
					name: s.name,
					status: s.status,
					enabled: s.enabled,
					totalDeliveries: s.totalDeliveries,
					failedDeliveries: s.failedDeliveries,
					errorMessage: s.errorMessage,
					lastTriggeredAt: s.lastTriggeredAt,
				})),
			};

			if (includeDeliveries && filtered.length === 1) {
				const deliveries = await apiRequest<{ deliveries: unknown[] }>(
					`/api/streams/${filtered[0].id}/deliveries?limit=5`,
					{ sessionToken },
				).catch(() => ({ deliveries: [] }));
				result.deliveries = deliveries.deliveries;
			}

			return result;
		},
	});
}
