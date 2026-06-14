import { RateLimitError } from "@secondlayer/shared/errors";
import { isPlatformMode } from "@secondlayer/shared/mode";
import type { MiddlewareHandler } from "hono";
import { getRateLimitStore } from "../auth/rate-limit-store.ts";
import type { IndexEnv } from "./auth.ts";
import {
	INDEX_ANON_RATE_LIMIT_PER_SECOND,
	INDEX_TIER_CONFIG,
} from "./tiers.ts";

const WINDOW_MS = 1_000;

export function indexRateLimit(): MiddlewareHandler<IndexEnv> {
	// biome-ignore lint/suspicious/noConfusingVoidType: hono middleware returns Response | void (pre-existing)
	return async (c, next): Promise<Response | void> => {
		// Self-hosted (oss/dedicated): single-tenant own box, no multi-tenant
		// fairness throttle. The operator owns access control (API_KEY / proxy).
		if (!isPlatformMode()) {
			await next();
			return;
		}
		// Pay-as-you-go: a credited free account is unthrottled (it pays per row).
		if (c.get("credited")) {
			await next();
			return;
		}
		const tenant = c.get("indexTenant");
		if (!tenant) {
			// Open-beta anon reads: enforce a shared global limit so clients
			// always receive X-RateLimit-* headers and scraping is bounded.
			const limit = INDEX_ANON_RATE_LIMIT_PER_SECOND;
			const result = await getRateLimitStore().check(
				"index:anon",
				limit,
				WINDOW_MS,
			);
			c.header("X-RateLimit-Limit", String(limit));
			c.header(
				"X-RateLimit-Remaining",
				String(Math.max(0, limit - result.count)),
			);
			c.header("X-RateLimit-Reset", String(result.resetAt));
			if (!result.allowed) {
				c.header("Retry-After", String(result.retryAfter));
				throw new RateLimitError("Rate limit exceeded");
			}
			await next();
			return;
		}
		const limit = INDEX_TIER_CONFIG[tenant.tier].rateLimitPerSecond;

		if (limit === null) {
			await next();
			return;
		}

		const result = await getRateLimitStore().check(
			`index:${tenant.tenant_id}`,
			limit,
			WINDOW_MS,
		);
		if (!result.allowed) {
			c.header("Retry-After", String(result.retryAfter));
			c.header("X-RateLimit-Limit", String(limit));
			c.header("X-RateLimit-Remaining", "0");
			c.header("X-RateLimit-Reset", String(result.resetAt));
			// Free-tier 429s point at the upgrade path instead of a bare error.
			if (tenant.tier === "free") {
				return c.json(
					{
						error: `Free tier is limited to ${limit} req/s on the Index surface. Upgrade for more headroom.`,
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
