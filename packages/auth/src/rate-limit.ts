import { RateLimitError } from "@secondlayer/shared/errors";
import type { MiddlewareHandler } from "hono";
import { SlidingWindow } from "./sliding-window.ts";

const DEFAULT_RATE_LIMIT = 120;

const window = new SlidingWindow();

export function rateLimit(): MiddlewareHandler {
	return async (c, next) => {
		const apiKey = c.get("apiKey");
		if (!apiKey) {
			await next();
			return;
		}

		const limit = apiKey.rate_limit ?? DEFAULT_RATE_LIMIT;
		const keyHash = apiKey.key_hash as string;
		const result = window.check(keyHash, limit);

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

/** Reset all rate limit state (for testing) */
export function _resetRateLimits() {
	window.clear();
}
