import type { MiddlewareHandler } from "hono";
import { RateLimitError } from "@secondlayer/shared/errors";

const DEFAULT_RATE_LIMIT = 120;
const WINDOW_MS = 60_000;
const CLEANUP_INTERVAL_MS = 5 * 60_000;

// keyHash → array of request timestamps
const windows = new Map<string, number[]>();

// Periodic cleanup of stale entries
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, timestamps] of windows) {
    const filtered = timestamps.filter((t) => t > cutoff);
    if (filtered.length === 0) {
      windows.delete(key);
    } else {
      windows.set(key, filtered);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

export function rateLimit(): MiddlewareHandler {
  return async (c, next) => {
    const apiKey = c.get("apiKey");
    if (!apiKey) {
      await next();
      return;
    }

    const limit = apiKey.rate_limit ?? DEFAULT_RATE_LIMIT;
    const keyHash = apiKey.key_hash as string;
    const now = Date.now();
    const cutoff = now - WINDOW_MS;

    let timestamps = windows.get(keyHash) ?? [];
    timestamps = timestamps.filter((t) => t > cutoff);

    if (timestamps.length >= limit) {
      const resetAt = Math.ceil((timestamps[0]! + WINDOW_MS) / 1000);
      const retryAfter = Math.ceil((timestamps[0]! + WINDOW_MS - now) / 1000);

      c.header("Retry-After", String(retryAfter));
      c.header("X-RateLimit-Limit", String(limit));
      c.header("X-RateLimit-Remaining", "0");
      c.header("X-RateLimit-Reset", String(resetAt));

      throw new RateLimitError("Rate limit exceeded");
    }

    timestamps.push(now);
    windows.set(keyHash, timestamps);

    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", String(limit - timestamps.length));
    c.header("X-RateLimit-Reset", String(Math.ceil((now + WINDOW_MS) / 1000)));

    await next();
  };
}

/** Reset all rate limit state (for testing) */
export function _resetRateLimits() {
  windows.clear();
}
