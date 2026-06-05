import { RateLimitError } from "@secondlayer/shared/errors";
import type { MiddlewareHandler } from "hono";
import { getClientIp } from "./http.ts";
import { getRateLimitStore } from "./rate-limit-store.ts";

const DEFAULT_MAX = 10;
const WINDOW_MS = 60_000;

export function ipRateLimit(max: number = DEFAULT_MAX): MiddlewareHandler {
	return async (c, next) => {
		const ip = getClientIp(c);
		if (ip === "unknown") {
			await next();
			return;
		}

		const result = await getRateLimitStore().check(`ip:${ip}`, max, WINDOW_MS);

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
