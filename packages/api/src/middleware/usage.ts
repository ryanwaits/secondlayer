import { getDb } from "@secondlayer/shared/db";
import { incrementApiRequests } from "@secondlayer/shared/db/queries/usage";
import type { Context, MiddlewareHandler } from "hono";

/**
 * Fire-and-forget API request counter. Runs after auth middleware
 * so accountId is available on context.
 */
export function countApiRequests(): MiddlewareHandler {
	return async (c: Context, next) => {
		await next();

		const accountId = c.get("accountId") as string | undefined;
		if (accountId) {
			const db = getDb();
			incrementApiRequests(db, accountId).catch(console.error);
		}
	};
}
