import {
	X402_STRIKE_TTL_SECONDS,
	x402StrikeKey,
} from "@secondlayer/shared/x402";
import { RedisClient } from "bun";

/**
 * Gate for the optimistic-serve path: decides whether a payer principal may be
 * served on broadcast-accept (near-instant) vs forced to confirmed-tier (block
 * until canonical). Two controls, both per-principal:
 *
 *  - **Velocity** — a fixed-window cap on optimistic calls. Bounds the fraud
 *    exposure of pay-then-drop (`max loss ≤ price-cap × velocity × principals`).
 *  - **Reputation (strikes)** — a principal that accumulates reverted (dropped /
 *    reorged-out) payments loses optimism and is forced to confirmed-tier.
 *
 * **Fails CLOSED**: if the gate can't be evaluated (Redis down/slow), it denies
 * optimism — the caller falls back to confirmed-tier, which has no fraud window.
 * That's the safe default (unlike the fail-OPEN request rate limiter).
 */

export const X402_OPTIMISTIC_VELOCITY_WINDOW_MS = 60_000; // 1 minute
export const X402_OPTIMISTIC_VELOCITY_LIMIT = 120; // optimistic calls / principal / window
export const X402_OPTIMISTIC_STRIKE_THRESHOLD = 3; // reverts before optimism is revoked

const REDIS_COMMAND_TIMEOUT_MS = 250;

export interface OptimisticGate {
	/** True → serve optimistically; false → fall back to confirmed-tier. */
	canServeOptimistically(principal: string): Promise<boolean>;
	/** Record a reverted payment for a principal (the reconciler calls this). */
	recordStrike(principal: string): Promise<void>;
	clear(): Promise<void>;
}

/** Process-local gate — correct for a single API instance and for tests. */
export class InProcOptimisticGate implements OptimisticGate {
	private readonly windows = new Map<
		string,
		{ count: number; resetAt: number }
	>();
	private readonly strikes = new Map<string, number>();

	async canServeOptimistically(principal: string): Promise<boolean> {
		if ((this.strikes.get(principal) ?? 0) >= X402_OPTIMISTIC_STRIKE_THRESHOLD)
			return false;
		const now = Date.now();
		const w = this.windows.get(principal);
		if (!w || w.resetAt <= now) {
			this.windows.set(principal, {
				count: 1,
				resetAt: now + X402_OPTIMISTIC_VELOCITY_WINDOW_MS,
			});
			return true;
		}
		if (w.count >= X402_OPTIMISTIC_VELOCITY_LIMIT) return false;
		w.count++;
		return true;
	}

	async recordStrike(principal: string): Promise<void> {
		this.strikes.set(principal, (this.strikes.get(principal) ?? 0) + 1);
	}

	async clear(): Promise<void> {
		this.windows.clear();
		this.strikes.clear();
	}
}

export class RedisOptimisticGate implements OptimisticGate {
	private readonly redis: RedisClient;

	constructor(url: string) {
		this.redis = new RedisClient(url);
	}

	private race<T>(p: Promise<T>): Promise<T> {
		p.catch(() => {});
		let timer: ReturnType<typeof setTimeout> | undefined;
		return Promise.race([
			p,
			new Promise<T>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("redis timeout")),
					REDIS_COMMAND_TIMEOUT_MS,
				);
			}),
		]).finally(() => {
			if (timer) clearTimeout(timer);
		});
	}

	async canServeOptimistically(principal: string): Promise<boolean> {
		try {
			const strikes = await this.race(
				this.redis.send("GET", [x402StrikeKey(principal)]),
			);
			if (
				strikes != null &&
				Number(strikes) >= X402_OPTIMISTIC_STRIKE_THRESHOLD
			)
				return false;

			// Fixed-window velocity counter (simple, atomic, fail-closed).
			const bucket = Math.floor(
				Date.now() / X402_OPTIMISTIC_VELOCITY_WINDOW_MS,
			);
			const key = `x402:vel:${principal}:${bucket}`;
			const count = Number(await this.race(this.redis.send("INCR", [key])));
			if (count === 1) {
				this.redis
					.send("PEXPIRE", [key, String(X402_OPTIMISTIC_VELOCITY_WINDOW_MS)])
					.catch(() => {});
			}
			return count <= X402_OPTIMISTIC_VELOCITY_LIMIT;
		} catch {
			// Fail CLOSED: can't prove the principal is within bounds → no optimism.
			return false;
		}
	}

	async recordStrike(principal: string): Promise<void> {
		try {
			const key = x402StrikeKey(principal);
			await this.redis.send("INCR", [key]);
			await this.redis.send("EXPIRE", [key, String(X402_STRIKE_TTL_SECONDS)]);
		} catch {
			// Best-effort; a missed strike just delays revoking optimism.
		}
	}

	async clear(): Promise<void> {
		let cursor = "0";
		do {
			const [next, keys] = (await this.redis.send("SCAN", [
				cursor,
				"MATCH",
				"x402:vel:*",
				"COUNT",
				"100",
			])) as [string, string[]];
			if (keys.length > 0) await this.redis.send("DEL", keys);
			cursor = next;
		} while (cursor !== "0");
	}
}

let cached: OptimisticGate | null = null;

export function getX402OptimisticGate(): OptimisticGate {
	if (cached) return cached;
	cached = process.env.REDIS_URL
		? new RedisOptimisticGate(process.env.REDIS_URL)
		: new InProcOptimisticGate();
	return cached;
}

/** Reset the memoized singleton (tests only). */
export async function _resetX402OptimisticGateForTests(): Promise<void> {
	if (cached) await cached.clear();
	cached = null;
}
