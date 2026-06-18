import { RateLimitError } from "@secondlayer/shared/errors";
import type { MiddlewareHandler } from "hono";
import { getClientIp } from "./http.ts";
import { getRateLimitStore } from "./rate-limit-store.ts";

const DEFAULT_MAX = 10;
const WINDOW_MS = 60_000;

export function ipRateLimit(max: number = DEFAULT_MAX): MiddlewareHandler {
	return async (c, next) => {
		const ip = getClientIp(c);
		// An unknown IP (no trusted proxy header) must NOT bypass — that would
		// grant uncapped auth attempts. Fail closed under one shared bucket. Auth
		// routes also fail closed if Redis is down (abuse-sensitive, not a read).
		const key = ip === "unknown" ? "ip:unknown" : `ip:${ip}`;
		const result = await getRateLimitStore().check(key, max, WINDOW_MS, {
			failClosed: true,
		});

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
