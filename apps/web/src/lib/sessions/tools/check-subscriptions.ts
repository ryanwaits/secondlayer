import { ApiError } from "@/lib/api";
import { fetchFromTenantOrThrow } from "@/lib/tenant-api";
import type { SubscriptionSummary } from "@/lib/types";
import { tool } from "ai";
import { z } from "zod";
import type { AccountInstance } from "./factory";

const NO_INSTANCE_RESULT = {
	subscriptions: [],
	setupRequired: true,
	missing: "instance",
	message:
		"No Secondlayer instance exists for this account yet. Create one from the Instance page or run `sl instance create --plan hobby` before creating subscriptions.",
	nextActions: [
		"Open `/instance` and create an instance.",
		"Deploy a subgraph after the instance is active.",
		"Then create a subscription for one of its tables.",
	],
};

export function createCheckSubscriptions(
	sessionToken: string,
	instance: AccountInstance,
) {
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
			if (instance.exists === false) return NO_INSTANCE_RESULT;

			let result: { data: SubscriptionSummary[] };
			try {
				result = await fetchFromTenantOrThrow<{
					data: SubscriptionSummary[];
				}>(sessionToken, "/api/subscriptions");
			} catch (err) {
				if (err instanceof ApiError && err.status === 404) {
					return NO_INSTANCE_RESULT;
				}
				throw err;
			}
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
