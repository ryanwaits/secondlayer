import { apiRequest } from "@/lib/api";
import type { DeadRow, DeliveryRow, SubgraphDetail } from "@/lib/types";
import { tool } from "ai";
import { z } from "zod";
import {
	buildSubscriptionDiagnostics,
	resolveSubscription,
} from "../subscriptions";

export function createDiagnoseSubscription(sessionToken: string) {
	return tool({
		description:
			"Diagnose one subscription by fetching detail, recent deliveries, dead-letter rows, and linked subgraph state. Returns actionable findings.",
		inputSchema: z.object({
			subscription: z
				.string()
				.describe("Subscription id or unique subscription name"),
		}),
		execute: async ({ subscription }) => {
			const detail = await resolveSubscription(sessionToken, subscription);
			const [deliveries, deadRows, subgraph] = await Promise.allSettled([
				apiRequest<{ data: DeliveryRow[] }>(
					`/api/subscriptions/${detail.id}/deliveries`,
					{ sessionToken },
				),
				apiRequest<{ data: DeadRow[] }>(
					`/api/subscriptions/${detail.id}/dead`,
					{ sessionToken },
				),
				apiRequest<SubgraphDetail>(`/api/subgraphs/${detail.subgraphName}`, {
					sessionToken,
				}),
			]);

			return buildSubscriptionDiagnostics({
				subscription: detail,
				deliveries:
					deliveries.status === "fulfilled" ? deliveries.value.data : [],
				deadRows: deadRows.status === "fulfilled" ? deadRows.value.data : [],
				subgraph: subgraph.status === "fulfilled" ? subgraph.value : null,
			});
		},
	});
}
