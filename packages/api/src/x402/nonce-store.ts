import { RedisClient } from "bun";

/**
 * One-shot nonce/replay store for the x402 rail. Each challenge nonce and each
 * settled txid may redeem exactly one response. This is the structural inverse of
 * `auth/rate-limit-store.ts`:
 *   - rate limiter: `EVAL` sliding window, FAILS OPEN (a Redis outage must not
 *     503 the whole API — over-allowing a rate limit is acceptable).
 *   - nonce store: atomic `SET key NX PX`, FAILS CLOSED (a Redis outage must not
 *     let a replay slip through — under-allowing a payment is the safe default).
 *
 * `consume(key)` returns `true` exactly once per key (first use), `false` on any
 * replay AND on any Redis error/timeout. Keys are caller-namespaced
 * (`x402:nonce:<nonce>`, `x402:txid:<txid>`).
 */
export interface NonceStore {
	/** Atomically claim `key`. `true` = first use (proceed); `false` = replay or unprovable. */
	consume(key: string, ttlMs: number): Promise<boolean>;
	clear(): Promise<void>;
}

/** Process-local store — correct for a single API instance and for tests. */
export class InProcNonceStore implements NonceStore {
	private readonly seen = new Map<string, number>();

	async consume(key: string, ttlMs: number): Promise<boolean> {
		const now = Date.now();
		const expires = this.seen.get(key);
		if (expires !== undefined && expires > now) return false;
		this.seen.set(key, now + ttlMs);
		return true;
	}

	async clear(): Promise<void> {
		this.seen.clear();
	}
}

// Same bound as the rate limiter: a hung Redis must not block the request. Here
// a timeout resolves to a REJECT (fail-closed), not an allow.
const REDIS_COMMAND_TIMEOUT_MS = 250;

export class RedisNonceStore implements NonceStore {
	private readonly redis: RedisClient;

	constructor(url: string) {
		this.redis = new RedisClient(url);
	}

	async consume(key: string, ttlMs: number): Promise<boolean> {
		try {
			const send = this.redis.send("SET", [
				`x402:${key}`,
				"1",
				"NX",
				"PX",
				String(ttlMs),
			]);
			// Swallow a late rejection if the timeout wins the race.
			send.catch(() => {});
			let timer: ReturnType<typeof setTimeout> | undefined;
			const reply = await Promise.race([
				send,
				new Promise((_, reject) => {
					timer = setTimeout(
						() => reject(new Error("redis timeout")),
						REDIS_COMMAND_TIMEOUT_MS,
					);
				}),
			]);
			if (timer) clearTimeout(timer);
			// SET NX returns "OK" when the key was set (first use), nil otherwise.
			return reply === "OK";
		} catch {
			// Fail CLOSED: if we can't prove the nonce is fresh, reject the payment.
			return false;
		}
	}

	async clear(): Promise<void> {
		let cursor = "0";
		do {
			const [next, keys] = (await this.redis.send("SCAN", [
				cursor,
				"MATCH",
				"x402:*",
				"COUNT",
				"100",
			])) as [string, string[]];
			if (keys.length > 0) await this.redis.send("DEL", keys);
			cursor = next;
		} while (cursor !== "0");
	}
}

let cachedStore: NonceStore | null = null;

export function getX402NonceStore(): NonceStore {
	if (cachedStore) return cachedStore;
	cachedStore = process.env.REDIS_URL
		? new RedisNonceStore(process.env.REDIS_URL)
		: new InProcNonceStore();
	return cachedStore;
}

/** Reset both the store contents and the memoized singleton (tests only). */
export async function _resetX402NonceStoreForTests(): Promise<void> {
	if (cachedStore) await cachedStore.clear();
	cachedStore = null;
}
