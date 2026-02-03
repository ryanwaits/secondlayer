/**
 * Simple token bucket rate limiter for per-stream webhook delivery
 * Note: This is per-worker; with N workers, actual rate = N × limit
 */

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, TokenBucket>();

const DEFAULT_RATE = 10; // requests per second
const REFILL_INTERVAL_MS = 1000;

/**
 * Acquire a token for the given stream
 * Returns immediately if token available, otherwise waits
 */
export async function acquireToken(
  streamId: string,
  rateLimit: number = DEFAULT_RATE
): Promise<void> {
  let bucket = buckets.get(streamId);

  if (!bucket) {
    bucket = { tokens: rateLimit, lastRefill: Date.now() };
    buckets.set(streamId, bucket);
  }

  // Refill tokens based on elapsed time
  const now = Date.now();
  const elapsed = now - bucket.lastRefill;
  const tokensToAdd = Math.floor(elapsed / REFILL_INTERVAL_MS) * rateLimit;

  if (tokensToAdd > 0) {
    bucket.tokens = Math.min(rateLimit, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now - (elapsed % REFILL_INTERVAL_MS);
  }

  // If tokens available, consume one
  if (bucket.tokens > 0) {
    bucket.tokens--;
    return;
  }

  // Wait for next refill
  const waitTime = REFILL_INTERVAL_MS - (now - bucket.lastRefill);
  await new Promise((r) => setTimeout(r, waitTime));

  // Recursive call to try again
  return acquireToken(streamId, rateLimit);
}

/**
 * Get current token count for a stream (for monitoring)
 */
export function getTokenCount(streamId: string): number {
  const bucket = buckets.get(streamId);
  return bucket?.tokens ?? 0;
}

/**
 * Clear rate limit state for a stream
 */
export function clearRateLimit(streamId: string): void {
  buckets.delete(streamId);
}

/**
 * Clear all rate limit state
 */
export function clearAllRateLimits(): void {
  buckets.clear();
}
