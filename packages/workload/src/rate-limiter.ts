/**
 * Per-account, per-bucket rate limiter for the gateway (Design, step 4).
 * Fixed-window counters, in-memory — the gateway is one process per
 * workload host (no fan-out to reason about yet), so this needs no shared
 * store. Env-tunable so an operator can raise a limit without a redeploy.
 *
 * Defaults (Design, founder-delegated 2026-09-24):
 *   create/update/delete (`write`) 30/min, `test` 10/min, `replay` 5/hour,
 *   reads 600/min.
 */

import type { RateLimitDecision, RateLimiter } from "./gateway.ts";

export type WebhooksRateLimitBucket = "write" | "test" | "replay" | "read";

const WINDOW_MS: Record<WebhooksRateLimitBucket, number> = {
	write: 60_000,
	test: 60_000,
	replay: 60 * 60_000,
	read: 60_000,
};

function defaultLimit(
	bucket: WebhooksRateLimitBucket,
	env: NodeJS.ProcessEnv,
): number {
	const envKey: Record<WebhooksRateLimitBucket, string> = {
		write: "WEBHOOKS_RATE_LIMIT_WRITE_PER_MIN",
		test: "WEBHOOKS_RATE_LIMIT_TEST_PER_MIN",
		replay: "WEBHOOKS_RATE_LIMIT_REPLAY_PER_HOUR",
		read: "WEBHOOKS_RATE_LIMIT_READ_PER_MIN",
	};
	const fallback: Record<WebhooksRateLimitBucket, number> = {
		write: 30,
		test: 10,
		replay: 5,
		read: 600,
	};
	const raw = env[envKey[bucket]];
	const parsed = raw ? Number(raw) : Number.NaN;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback[bucket];
}

interface Window {
	count: number;
	resetAt: number;
}

/** In-memory fixed-window limiter. `now` is injectable for tests; a real
 *  gateway process just uses `Date.now`. */
export function createRateLimiter(
	env: NodeJS.ProcessEnv = process.env,
	now: () => number = Date.now,
): RateLimiter {
	const windows = new Map<string, Window>();

	return (accountId: string, bucket: string): RateLimitDecision => {
		const b = bucket as WebhooksRateLimitBucket;
		const limit = defaultLimit(b, env);
		const windowMs = WINDOW_MS[b] ?? 60_000;
		const key = `${accountId}:${b}`;
		const t = now();

		let w = windows.get(key);
		if (!w || w.resetAt <= t) {
			w = { count: 0, resetAt: t + windowMs };
			windows.set(key, w);
		}

		w.count += 1;
		if (w.count > limit) {
			return {
				allowed: false,
				retryAfterSeconds: Math.max(1, Math.ceil((w.resetAt - t) / 1000)),
			};
		}
		return { allowed: true };
	};
}
