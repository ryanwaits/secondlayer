const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_CLEANUP_MS = 5 * 60_000;

export interface WindowResult {
  allowed: boolean;
  count: number;
  retryAfter: number;
  resetAt: number;
}

export class SlidingWindow {
  private windows = new Map<string, number[]>();
  private windowMs: number;

  constructor(windowMs = DEFAULT_WINDOW_MS, cleanupMs = DEFAULT_CLEANUP_MS) {
    this.windowMs = windowMs;
    setInterval(() => {
      const cutoff = Date.now() - this.windowMs;
      for (const [key, timestamps] of this.windows) {
        const filtered = timestamps.filter((t) => t > cutoff);
        if (filtered.length === 0) {
          this.windows.delete(key);
        } else {
          this.windows.set(key, filtered);
        }
      }
    }, cleanupMs).unref();
  }

  check(key: string, limit: number): WindowResult {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    let timestamps = (this.windows.get(key) ?? []).filter((t) => t > cutoff);

    if (timestamps.length >= limit) {
      const retryAfter = Math.ceil((timestamps[0]! + this.windowMs - now) / 1000);
      const resetAt = Math.ceil((timestamps[0]! + this.windowMs) / 1000);
      return { allowed: false, count: timestamps.length, retryAfter, resetAt };
    }

    timestamps.push(now);
    this.windows.set(key, timestamps);
    return {
      allowed: true,
      count: timestamps.length,
      retryAfter: 0,
      resetAt: Math.ceil((now + this.windowMs) / 1000),
    };
  }

  clear() {
    this.windows.clear();
  }
}
