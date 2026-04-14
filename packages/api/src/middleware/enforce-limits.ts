import { getDb } from "@secondlayer/shared/db";
import { getAccountById } from "@secondlayer/shared/db/queries/accounts";
import { checkLimits } from "@secondlayer/shared/db/queries/usage";
import type { Context, MiddlewareHandler } from "hono";

/**
 * Enforce free tier limits on mutation endpoints.
 * Optionally specify which resource to check (streams/subgraphs).
 * DEV_MODE bypasses enforcement.
 */
export function enforceLimits(
	resource?: "streams" | "subgraphs",
): MiddlewareHandler {
	return async (c: Context, next) => {
		if (process.env.DEV_MODE === "true") {
			await next();
			return;
		}

		const accountId = c.get("accountId") as string | undefined;
		if (!accountId) {
			await next();
			return;
		}

		const db = getDb();
		const account = await getAccountById(db, accountId);
		if (!account) {
			await next();
			return;
		}

		const result = await checkLimits(db, accountId, account.plan);

		if (!result.allowed && result.exceeded) {
			// If a specific resource is requested, only block if that resource is exceeded
			if (resource && result.exceeded !== resource) {
				await next();
				return;
			}
			// If no specific resource, block on api_requests exceeded
			if (!resource && result.exceeded !== "api_requests") {
				await next();
				return;
			}

			const limitKey = limitKeyMap[result.exceeded] ?? result.exceeded;
			const currentKey = currentKeyMap[result.exceeded] ?? result.exceeded;
			const limitsRecord = result.limits as Record<string, number | undefined>;
			const currentRecord = result.current as Record<
				string,
				number | undefined
			>;

			return c.json(
				{
					error: `Plan limit exceeded: ${result.exceeded}`,
					code: "LIMIT_EXCEEDED",
					limit: limitsRecord[limitKey],
					current: currentRecord[currentKey],
					resource: result.exceeded,
				},
				429,
			);
		}

		await next();
		return;
	};
}

const limitKeyMap: Record<string, string> = {
	streams: "streams",
	subgraphs: "subgraphs",
	api_requests: "apiRequestsPerDay",
	deliveries: "deliveriesPerMonth",
	storage: "storageBytes",
};

const currentKeyMap: Record<string, string> = {
	streams: "streams",
	subgraphs: "subgraphs",
	api_requests: "apiRequestsToday",
	deliveries: "deliveriesThisMonth",
	storage: "storageBytes",
};
