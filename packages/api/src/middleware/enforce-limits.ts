import type { MiddlewareHandler } from "hono";
import { getDb } from "@secondlayer/shared/db";
import { checkLimits } from "@secondlayer/shared/db/queries/usage";
import { getAccountById } from "@secondlayer/shared/db/queries/accounts";

/**
 * Enforce free tier limits on mutation endpoints.
 * Optionally specify which resource to check (streams/views).
 * DEV_MODE bypasses enforcement.
 */
export function enforceLimits(resource?: "streams" | "views"): MiddlewareHandler {
  return async (c, next) => {
    if (process.env.DEV_MODE === "true") {
      await next();
      return;
    }

    const accountId = (c as any).get("accountId") as string | undefined;
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

    if (!result.allowed) {
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

      return c.json(
        {
          error: `Plan limit exceeded: ${result.exceeded}`,
          code: "LIMIT_EXCEEDED",
          limit: (result.limits as any)[limitKeyMap[result.exceeded!] ?? result.exceeded!],
          current: (result.current as any)[currentKeyMap[result.exceeded!] ?? result.exceeded!],
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
  views: "views",
  api_requests: "apiRequestsPerDay",
  deliveries: "deliveriesPerMonth",
  storage: "storageBytes",
};

const currentKeyMap: Record<string, string> = {
  streams: "streams",
  views: "views",
  api_requests: "apiRequestsToday",
  deliveries: "deliveriesThisMonth",
  storage: "storageBytes",
};
