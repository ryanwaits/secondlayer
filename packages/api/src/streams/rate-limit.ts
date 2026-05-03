import { RateLimitError } from "@secondlayer/shared/errors";
import type { MiddlewareHandler } from "hono";
import { SlidingWindow } from "../auth/sliding-window.ts";
import type { StreamsEnv } from "./auth.ts";
import { STREAMS_TIER_CONFIG } from "./tiers.ts";

export function streamsRateLimit(opts?: {
	window?: SlidingWindow;
}): MiddlewareHandler<StreamsEnv> {
	// TODO: replace process-local windows with Redis-backed counters before
	// running multiple API gateway instances.
	// TODO: SlidingWindow uses real time. Tests rely on Bun being fast
	// enough to fit 11 requests inside a 1s window. Inject a clock
	// function so tests can advance time deterministically.
	const window = opts?.window ?? new SlidingWindow(1_000);

	return async (c, next) => {
		const tenant = c.get("streamsTenant");
		const limit = STREAMS_TIER_CONFIG[tenant.tier].rateLimitPerSecond;

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
			throw new RateLimitError("Rate limit exceeded");
		}

		c.header("X-RateLimit-Limit", String(limit));
		c.header("X-RateLimit-Remaining", String(limit - result.count));
		c.header("X-RateLimit-Reset", String(result.resetAt));

		await next();
	};
}
