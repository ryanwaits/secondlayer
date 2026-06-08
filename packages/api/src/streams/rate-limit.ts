import { RateLimitError } from "@secondlayer/shared/errors";
import type { MiddlewareHandler } from "hono";
import { getRateLimitStore } from "../auth/rate-limit-store.ts";
import type { StreamsEnv } from "./auth.ts";
import {
	STREAMS_ANON_RATE_LIMIT_PER_SECOND,
	STREAMS_TIER_CONFIG,
} from "./tiers.ts";

const WINDOW_MS = 1_000;

export function streamsRateLimit(): MiddlewareHandler<StreamsEnv> {
	return async (c, next) => {
		const tenant = c.get("streamsTenant");
		if (!tenant) {
			// x402-paid accountless reads: shared global bucket so every caller gets
			// X-RateLimit-* headers and scraping is bounded.
			const anonLimit = STREAMS_ANON_RATE_LIMIT_PER_SECOND;
			const anon = await getRateLimitStore().check(
				"streams:anon",
				anonLimit,
				WINDOW_MS,
			);
			c.header("X-RateLimit-Limit", String(anonLimit));
			c.header(
				"X-RateLimit-Remaining",
				String(Math.max(0, anonLimit - anon.count)),
			);
			c.header("X-RateLimit-Reset", String(anon.resetAt));
			if (!anon.allowed) {
				c.header("Retry-After", String(anon.retryAfter));
				throw new RateLimitError("Rate limit exceeded");
			}
			await next();
			return;
		}
		const limit = STREAMS_TIER_CONFIG[tenant.tier].rateLimitPerSecond;

		if (limit === null) {
			await next();
			return;
		}

		const result = await getRateLimitStore().check(
			`streams:${tenant.tenant_id}`,
			limit,
			WINDOW_MS,
		);
		if (!result.allowed) {
			c.header("Retry-After", String(result.retryAfter));
			c.header("X-RateLimit-Limit", String(limit));
			c.header("X-RateLimit-Remaining", "0");
			c.header("X-RateLimit-Reset", String(result.resetAt));
			throw new RateLimitError("Rate limit exceeded");
		}

		c.header("X-RateLimit-Limit", String(limit));
		c.header("X-RateLimit-Remaining", String(limit - result.count));
		c.header("X-RateLimit-Reset", String(result.resetAt));

		await next();
	};
}
