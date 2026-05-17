import { RateLimitError } from "@secondlayer/shared/errors";
import type { MiddlewareHandler } from "hono";
import { SlidingWindow } from "../auth/sliding-window.ts";
import type { IndexEnv } from "./auth.ts";
import { INDEX_TIER_CONFIG } from "./tiers.ts";

export function indexRateLimit(opts?: {
	window?: SlidingWindow;
}): MiddlewareHandler<IndexEnv> {
	const window = opts?.window ?? new SlidingWindow(1_000);

	return async (c, next): Promise<Response | void> => {
		const tenant = c.get("indexTenant");
		if (!tenant) {
			await next();
			return;
		}
		const limit = INDEX_TIER_CONFIG[tenant.tier].rateLimitPerSecond;

		if (limit === null) {
			await next();
			return;
		}

		const result = window.check(tenant.tenant_id, limit);
		if (!result.allowed) {
			c.header("Retry-After", String(result.retryAfter));
			c.header("X-RateLimit-Limit", String(limit));
			c.header("X-RateLimit-Remaining", "0");
			c.header("X-RateLimit-Reset", String(result.resetAt));
			// Free tier (limit=0) is the only place limit hits on the first
			// request. Make the upgrade path obvious instead of a bare 429.
			if (tenant.tier === "free") {
				return c.json(
					{
						error:
							"Index API requires Build+ tier. Free tier is limited to 0 req/s on the Index surface.",
						code: "RATE_LIMIT_ERROR",
						required_tier: "build",
						upgrade_url: "https://secondlayer.tools/platform/billing",
					},
					429,
				);
			}
			throw new RateLimitError("Rate limit exceeded");
		}

		c.header("X-RateLimit-Limit", String(limit));
		c.header("X-RateLimit-Remaining", String(limit - result.count));
		c.header("X-RateLimit-Reset", String(result.resetAt));

		await next();
	};
}
