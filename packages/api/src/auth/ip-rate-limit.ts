import { RateLimitError } from "@secondlayer/shared/errors";
import type { MiddlewareHandler } from "hono";
import { getClientIp } from "./http.ts";
import { SlidingWindow } from "./sliding-window.ts";

const DEFAULT_MAX = 10;

const window = new SlidingWindow();

export function ipRateLimit(max: number = DEFAULT_MAX): MiddlewareHandler {
	return async (c, next) => {
		const ip = getClientIp(c);
		if (ip === "unknown") {
			await next();
			return;
		}

		const result = window.check(ip, max);

		c.header("X-RateLimit-Limit", String(max));
		c.header("X-RateLimit-Remaining", String(Math.max(0, max - result.count)));
		c.header("X-RateLimit-Reset", String(result.resetAt));

		if (!result.allowed) {
			c.header("Retry-After", String(result.retryAfter));
			throw new RateLimitError("Rate limit exceeded");
		}

		await next();
	};
}
