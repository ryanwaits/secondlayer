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

		if (!result.allowed) {
			c.header("Retry-After", String(result.retryAfter));
			throw new RateLimitError("Rate limit exceeded");
		}

		await next();
	};
}
