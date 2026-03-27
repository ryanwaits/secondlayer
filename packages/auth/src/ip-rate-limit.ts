import type { MiddlewareHandler } from "hono";
import { RateLimitError } from "@secondlayer/shared/errors";
import { getClientIp } from "./http.ts";

const DEFAULT_MAX = 10;
const WINDOW_MS = 60_000;
const CLEANUP_INTERVAL_MS = 5 * 60_000;

// ip → array of request timestamps
const windows = new Map<string, number[]>();

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

export function ipRateLimit(max: number = DEFAULT_MAX): MiddlewareHandler {
  return async (c, next) => {
    const ip = getClientIp(c);
    if (ip === "unknown") {
      await next();
      return;
    }

    const now = Date.now();
    const cutoff = now - WINDOW_MS;

    let timestamps = windows.get(ip) ?? [];
    timestamps = timestamps.filter((t) => t > cutoff);

    if (timestamps.length >= max) {
      const retryAfter = Math.ceil((timestamps[0]! + WINDOW_MS - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      throw new RateLimitError("Rate limit exceeded");
    }

    timestamps.push(now);
    windows.set(ip, timestamps);

    await next();
  };
}
