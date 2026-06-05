import { RedisClient } from "bun";
import { SlidingWindow, type WindowResult } from "./sliding-window.ts";

/**
 * Backing store for the sliding-window rate limiters. Process-local
 * (`InProcRateLimitStore`) is correct for a single API instance; once the API
 * scales horizontally, only the Redis-backed store enforces a shared limit.
 * Selected by REDIS_URL presence at first use. `key` must be caller-namespaced
 * (e.g. `apikey:<hash>`, `streams:<tenant>`) so distinct limiters don't share a
 * counter.
 */
export interface RateLimitStore {
	check(key: string, limit: number, windowMs: number): Promise<WindowResult>;
	clear(): Promise<void>;
}

export class InProcRateLimitStore implements RateLimitStore {
	// One SlidingWindow per distinct windowMs (its window length is fixed at
	// construction). All callers sharing a windowMs share cleanup, not counters
	// (keys are namespaced by the caller).
	private readonly windows = new Map<number, SlidingWindow>();

	private windowFor(windowMs: number): SlidingWindow {
		let w = this.windows.get(windowMs);
		if (!w) {
			w = new SlidingWindow(windowMs);
			this.windows.set(windowMs, w);
		}
		return w;
	}

	async check(
		key: string,
		limit: number,
		windowMs: number,
	): Promise<WindowResult> {
		return this.windowFor(windowMs).check(key, limit);
	}

	async clear(): Promise<void> {
		for (const w of this.windows.values()) w.clear();
	}
}

// Atomic sliding-window check in one round-trip: drop expired members, count,
// and (if under limit) add the new request. Returns {allowed, count, oldestMs}.
// oldestMs is the score of the earliest live member (0 when none) so the caller
// can compute retryAfter/resetAt identically to the in-proc window.
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - windowMs)
local count = redis.call('ZCARD', key)
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldestMs = oldest[2] or 0
if count >= limit then
  return {0, count, oldestMs}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, windowMs)
return {1, count + 1, oldestMs}
`;

// Cap on how long a rate-limit check waits on Redis. If Redis is slow or
// unreachable the check must fail OPEN fast — a hung command would block the
// request and defeat the whole point of failing open.
const REDIS_COMMAND_TIMEOUT_MS = 250;

export class RedisRateLimitStore implements RateLimitStore {
	private readonly redis: RedisClient;

	constructor(url: string) {
		this.redis = new RedisClient(url);
	}

	async check(
		key: string,
		limit: number,
		windowMs: number,
	): Promise<WindowResult> {
		const now = Date.now();
		// Unique member: a pure timestamp would collide (and undercount) under a
		// same-millisecond burst, so suffix a UUID.
		const member = `${now}-${crypto.randomUUID()}`;
		try {
			const send = this.redis.send("EVAL", [
				SLIDING_WINDOW_LUA,
				"1",
				`rl:${key}`,
				String(now),
				String(windowMs),
				String(limit),
				member,
			]);
			// Swallow a late rejection if the timeout wins the race, so it doesn't
			// surface as an unhandled rejection.
			send.catch(() => {});
			let timer: ReturnType<typeof setTimeout> | undefined;
			const reply = (await Promise.race([
				send,
				new Promise((_, reject) => {
					timer = setTimeout(
						() => reject(new Error("redis timeout")),
						REDIS_COMMAND_TIMEOUT_MS,
					);
				}),
			])) as [unknown, unknown, unknown];
			if (timer) clearTimeout(timer);
			// RESP can surface integers as strings — coerce defensively.
			const allowed = Number(reply[0]) === 1;
			const count = Number(reply[1]);
			const oldestMs = Number(reply[2]) || 0;
			if (!allowed) {
				return {
					allowed: false,
					count,
					retryAfter: Math.ceil((oldestMs + windowMs - now) / 1000),
					resetAt: Math.ceil((oldestMs + windowMs) / 1000),
				};
			}
			return {
				allowed: true,
				count,
				retryAfter: 0,
				resetAt: Math.ceil((now + windowMs) / 1000),
			};
		} catch {
			// Fail OPEN: a Redis outage must not 503 the whole API. Limits stop
			// enforcing until Redis recovers; the request is allowed through.
			return {
				allowed: true,
				count: 0,
				retryAfter: 0,
				resetAt: Math.ceil((now + windowMs) / 1000),
			};
		}
	}

	async clear(): Promise<void> {
		// Test-only: drop every limiter key. SCAN avoids blocking on KEYS.
		let cursor = "0";
		do {
			const [next, keys] = (await this.redis.send("SCAN", [
				cursor,
				"MATCH",
				"rl:*",
				"COUNT",
				"100",
			])) as [string, string[]];
			if (keys.length > 0) await this.redis.send("DEL", keys);
			cursor = next;
		} while (cursor !== "0");
	}
}

let cachedStore: RateLimitStore | null = null;

export function getRateLimitStore(): RateLimitStore {
	if (cachedStore) return cachedStore;
	cachedStore = process.env.REDIS_URL
		? new RedisRateLimitStore(process.env.REDIS_URL)
		: new InProcRateLimitStore();
	return cachedStore;
}

/** Reset both the store contents and the memoized singleton (tests only). */
export async function _resetRateLimitStoreForTests(): Promise<void> {
	if (cachedStore) await cachedStore.clear();
	cachedStore = null;
}
