import { RateLimitError } from "@secondlayer/shared/errors";
import type { MiddlewareHandler } from "hono";
import { getClientIp } from "./http.ts";
import { getRateLimitStore } from "./rate-limit-store.ts";

const DEFAULT_MAX = 10;
const WINDOW_MS = 60_000;

/**
 * Per-IP limiter. `scope` gives a route group its own counter; without it every
 * limiter shares one bucket per IP, so a chatty route (the CLI's sign-in poll)
 * would eat the budget of a stricter one (`/api/auth/*`).
 */
export function ipRateLimit(
	max: number = DEFAULT_MAX,
	scope?: string,
): MiddlewareHandler {
	return async (c, next) => {
		const ip = getClientIp(c);
		// An unknown IP (no trusted proxy header) must NOT bypass — that would
		// grant uncapped auth attempts. Fail closed under one shared bucket. Auth
		// routes also fail closed if Redis is down (abuse-sensitive, not a read).
		const prefix = scope ? `ip:${scope}` : "ip";
		const key = ip === "unknown" ? `${prefix}:unknown` : `${prefix}:${ip}`;
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
