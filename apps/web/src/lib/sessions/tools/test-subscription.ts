import { fetchFromTenantOrThrow } from "@/lib/tenant-api";
import type { SubgraphDetail } from "@/lib/types";
import { tool } from "ai";
import { z } from "zod";
import {
	buildSignedSubscriptionFixture,
	representativeSubscriptionRow,
	resolveSubscription,
} from "../subscriptions";

export function createTestSubscription(sessionToken: string) {
	return tool({
		description:
			"Generate a Standard Webhooks body, headers, and curl for a subscription using only a caller-provided signing secret. Never POST and never read a stored platform secret.",
		inputSchema: z.object({
			subscription: z
				.string()
				.describe("Subscription id or unique subscription name"),
			signingSecret: z
				.string()
				.min(1)
				.describe("User-provided signing secret. Do not use stored secrets."),
			row: z
				.record(z.string(), z.unknown())
				.optional()
				.describe("Optional explicit row payload for the test fixture"),
		}),
		execute: async ({ subscription, signingSecret, row }) => {
			const detail = await resolveSubscription(sessionToken, subscription);
			const subgraph = await fetchFromTenantOrThrow<SubgraphDetail>(
				sessionToken,
				`/api/subgraphs/${detail.subgraphName}`,
			).catch(() => null);
			const payloadRow =
				row ??
				(await representativeSubscriptionRow(sessionToken, detail, subgraph));
			const fixture = buildSignedSubscriptionFixture({
				subscription: detail,
				row: payloadRow,
				signingSecret,
			});

			return {
				subscription: {
					id: detail.id,
					name: detail.name,
					target: `${detail.subgraphName}.${detail.tableName}`,
					url: detail.url,
				},
				...fixture,
			};
		},
	});
}
