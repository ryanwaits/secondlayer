import { fetchFromTenantOrThrow } from "@/lib/tenant-api";
import type { SubscriptionSummary } from "@/lib/types";
import { tool } from "ai";
import { z } from "zod";

export function createCheckSubscriptions(sessionToken: string) {
	return tool({
		description:
			"List the user's subscriptions with status, target table, runtime, last delivery, and last success. Use before creating, diagnosing, or managing subscriptions.",
		inputSchema: z.object({
			subgraphName: z
				.string()
				.optional()
				.describe("Filter subscriptions to one subgraph name."),
			status: z
				.enum(["active", "paused", "error"])
				.optional()
				.describe("Filter by subscription status."),
		}),
		execute: async ({ subgraphName, status }) => {
			const result = await fetchFromTenantOrThrow<{
				data: SubscriptionSummary[];
			}>(sessionToken, "/api/subscriptions");
			const subscriptions = result.data.filter((sub) => {
				if (subgraphName && sub.subgraphName !== subgraphName) return false;
				if (status && sub.status !== status) return false;
				return true;
			});
			return {
				subscriptions: subscriptions.map((sub) => ({
					id: sub.id,
					name: sub.name,
					status: sub.status,
					target: `${sub.subgraphName}.${sub.tableName}`,
					subgraphName: sub.subgraphName,
					tableName: sub.tableName,
					format: sub.format,
					runtime: sub.runtime,
					url: sub.url,
					lastDeliveryAt: sub.lastDeliveryAt,
					lastSuccessAt: sub.lastSuccessAt,
				})),
			};
		},
	});
}
