import { logger } from "@secondlayer/shared";
import {
	getRedisClient,
	redisSendWithTimeout,
} from "../auth/rate-limit-store.ts";

/**
 * Bounded in-flight slots per key (a ghost's reads, an account's SSE
 * connections, an account's contract reads). Redis-backed when `REDIS_URL`
 * is set so the bound holds across API replicas; process-local otherwise
 * (self-host, dev). `ttlMs` is a safety net: a slot whose holder crashed
 * without releasing expires instead of leaking, so it must outlast the
 * longest legitimate hold.
 *
 * A Redis outage fails OPEN (the slot is granted, nothing is counted), the
 * same as the data-read rate limiters: a blip must not refuse reads.
 */
export interface SlotCounter {
	/** A `release` for the slot taken, or `null` when `key` already holds
	 *  `limit`. `release` is idempotent. */
	acquire(
		key: string,
		limit: number,
		ttlMs: number,
	): Promise<(() => Promise<void>) | null>;
}

const NOOP_RELEASE = async () => {};

export class InProcSlotCounter implements SlotCounter {
	private readonly held = new Map<string, number>();

	async acquire(key: string, limit: number) {
		const n = this.held.get(key) ?? 0;
		if (n >= limit) return null;
		this.held.set(key, n + 1);
		let released = false;
		return async () => {
			if (released) return;
			released = true;
			const left = (this.held.get(key) ?? 1) - 1;
			if (left <= 0) this.held.delete(key);
			else this.held.set(key, left);
		};
	}
}

// Take a slot atomically: count up, back out if over the limit, and refresh
// the expiry so an idle key's counter cleans itself up.
const ACQUIRE_LUA = `
local n = redis.call('INCR', KEYS[1])
if n > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return 0
end
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`;

const RELEASE_LUA = `
local n = redis.call('DECR', KEYS[1])
if n <= 0 then redis.call('DEL', KEYS[1]) end
return n
`;

export class RedisSlotCounter implements SlotCounter {
	private readonly redis;

	constructor(url: string) {
		this.redis = getRedisClient(url);
	}

	async acquire(key: string, limit: number, ttlMs: number) {
		const redisKey = `slots:${key}`;
		try {
			const taken = await redisSendWithTimeout(this.redis, "EVAL", [
				ACQUIRE_LUA,
				"1",
				redisKey,
				String(limit),
				String(ttlMs),
			]);
			if (Number(taken) !== 1) return null;
		} catch {
			logSlotFailure();
			return NOOP_RELEASE;
		}
		let released = false;
		return async () => {
			if (released) return;
			released = true;
			try {
				await redisSendWithTimeout(this.redis, "EVAL", [
					RELEASE_LUA,
					"1",
					redisKey,
				]);
			} catch {
				// The TTL reclaims it.
			}
		};
	}

	async clear(): Promise<void> {
		let cursor = "0";
		do {
			const [next, keys] = (await this.redis.send("SCAN", [
				cursor,
				"MATCH",
				"slots:*",
				"COUNT",
				"100",
			])) as [string, string[]];
			if (keys.length > 0) await this.redis.send("DEL", keys);
			cursor = next;
		} while (cursor !== "0");
	}
}

let lastFailLogMs = 0;
function logSlotFailure(): void {
	const now = Date.now();
	if (now - lastFailLogMs < 60_000) return;
	lastFailLogMs = now;
	logger.warn(
		"Slot counter: Redis unavailable — in-flight bounds are not enforced until it recovers",
	);
}

let cached: SlotCounter | null = null;

export function getSlotCounter(): SlotCounter {
	if (cached) return cached;
	cached = process.env.REDIS_URL
		? new RedisSlotCounter(process.env.REDIS_URL)
		: new InProcSlotCounter();
	return cached;
}

/** Drop the memoized counter and any Redis slots (tests only). */
export async function _resetSlotCounterForTests(): Promise<void> {
	if (cached instanceof RedisSlotCounter) await cached.clear();
	cached = null;
}
