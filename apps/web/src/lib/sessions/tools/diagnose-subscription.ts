import { fetchFromTenantOrThrow } from "@/lib/tenant-api";
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
				fetchFromTenantOrThrow<{ data: DeliveryRow[] }>(
					sessionToken,
					`/api/subscriptions/${detail.id}/deliveries`,
				),
				fetchFromTenantOrThrow<{ data: DeadRow[] }>(
					sessionToken,
					`/api/subscriptions/${detail.id}/dead`,
				),
				fetchFromTenantOrThrow<SubgraphDetail>(
					sessionToken,
					`/api/subgraphs/${detail.subgraphName}`,
				),
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
