import type { MiddlewareHandler } from "hono";
import { getDb } from "@secondlayer/shared/db";
import { incrementApiRequests } from "@secondlayer/shared/db/queries/usage";

/**
 * Fire-and-forget API request counter. Runs after auth middleware
 * so accountId is available on context.
 */
export function countApiRequests(): MiddlewareHandler {
  return async (c, next) => {
    await next();

    const accountId = (c as any).get("accountId") as string | undefined;
    if (accountId) {
      const db = getDb();
      incrementApiRequests(db, accountId).catch(console.error);
    }
  };
}
