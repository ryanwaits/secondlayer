import postgres from "postgres";
import {
	describeDbUrl,
	resolveSourceUrl,
	resolveTargetUrl,
} from "../db/index.ts";
import { logger } from "../logger.ts";

interface ListenOptions {
	/**
	 * Connection string to LISTEN on. Defaults to `process.env.DATABASE_URL`.
	 * In dual-DB mode, pass `SOURCE_DATABASE_URL` for indexer-fired channels
	 * (`indexer:new_block`, `subgraph_reorg`, `tx:confirmed`) and
	 * `TARGET_DATABASE_URL` for tenant-local channels (`subgraph_changes`).
	 */
	connectionString?: string;
}

/**
 * LISTEN/NOTIFY connection for indexer-fired channels (`indexer:new_block`,
 * `subgraph_reorg`, `tx:confirmed`, `index:tip`) — they fire wherever
 * `getSourceDb()` writes. Delegates to `resolveSourceUrl` (the same function
 * `getSourceDb()` calls) instead of re-deriving the env-var precedence here:
 * a hand-duplicated resolver previously skipped the `isPlatformMode()` gate
 * that `getSourceDb()` applies, so a process not in platform mode (but with
 * `SOURCE_DATABASE_URL` set anyway, e.g. inherited from a shared env
 * template) would LISTEN on a different database than the one the write
 * actually commits to — a NOTIFY that fires correctly on the writer's
 * connection then never reaches this listener. One resolver, used by both.
 */
export function sourceListenerUrl(): string {
	return resolveSourceUrl();
}

/**
 * LISTEN/NOTIFY connection for control-plane channels (`webhooks:new_outbox`,
 * `webhooks:changed`, subgraph operations) — they fire wherever `getTargetDb()`
 * writes. See {@link sourceListenerUrl} for why this delegates instead of
 * re-deriving the precedence.
 */
export function targetListenerUrl(): string {
	return resolveTargetUrl();
}

function resolveUrl(opts?: ListenOptions): string {
	// `||` not `??`: an empty-string connectionString (e.g. an unset
	// SOURCE_/TARGET_DATABASE_URL passed through docker-compose as "") must fall
	// back to DATABASE_URL, not be treated as a valid value.
	const url = opts?.connectionString || process.env.DATABASE_URL;
	if (!url) {
		throw new Error(
			"listen/notify requires a connection string (opts.connectionString or DATABASE_URL)",
		);
	}
	return url;
}

/**
 * postgres.js's LISTEN connection already reconnects on its own (backoff,
 * re-issues `LISTEN` for every channel, `onlisten` fires again after each
 * reconnect) — see `node_modules/postgres/src/index.js`'s `listen()`, which
 * hardcodes `idle_timeout`/`max_lifetime` to `null` on its dedicated
 * connection regardless of what's passed here, so nothing we set can defeat
 * it. What it does NOT do is replay a NOTIFY that fired while the connection
 * was down. So on every reconnect (not the initial connect) we log it and
 * fire one synthetic call to `callback` with no payload — every caller here
 * treats a missing/unparseable payload as "go re-check current state," which
 * is exactly right for "a NOTIFY may have been missed."
 */
export async function listen(
	channel: string,
	callback: (payload?: string) => void,
	opts?: ListenOptions,
): Promise<() => Promise<void>> {
	const url = resolveUrl(opts);
	const client = postgres(url, {
		max: 1,
		onnotice: () => {},
	});

	let connectedOnce = false;
	await client.listen(
		channel,
		(payload) => {
			callback(payload);
		},
		() => {
			if (connectedOnce) {
				logger.info("LISTEN connection reconnected", {
					event: "listener_reconnected",
					channel,
					db: describeDbUrl(url),
				});
				callback();
			}
			connectedOnce = true;
		},
	);

	return async () => {
		await client.end();
	};
}

/** A shareable wake point: any number of callers can `wait()` for the next
 *  NOTIFY on `channel`, each getting their own promise. One LISTEN connection
 *  backs every waiter, so a decoder pool or an API replica needs only one
 *  `createWakeBus` per process per channel, not one per caller. */
export type WakeBus = {
	/** Resolves on the next NOTIFY. A fresh promise every call — safe to call
	 *  again immediately after it resolves. */
	wait: () => Promise<void>;
	/**
	 * Monotonically increasing counter, bumped once per NOTIFY received —
	 * before resolving any waiters pending at that moment — never decreasing,
	 * never resetting, starting at 0. Lets a caller record "the generation as
	 * of some point in time" and later ask "has a NOTIFY landed since then"
	 * without having been an active `wait()`er when it happened. This closes
	 * the check-then-wait race every poll-then-wait loop otherwise has: a
	 * NOTIFY that fires between a caller checking for fresh state and it
	 * registering a fresh `wait()` resolves zero waiters (nobody was
	 * listening yet) and would otherwise be missed until the NEXT NOTIFY.
	 */
	generation: () => number;
	/** Close the underlying LISTEN connection and resolve every pending waiter
	 *  (so nothing blocks forever on shutdown). */
	stop: () => Promise<void>;
};

/**
 * Start a `WakeBus` on `channel`. Callers that only need a fallback timer if
 * this fails should catch the rejection and keep polling — a wake bus is an
 * optimization, never the only path to progress (see plan-063 D3).
 */
export async function createWakeBus(
	channel: string,
	opts?: ListenOptions,
): Promise<WakeBus> {
	let waiters = new Set<() => void>();
	let generation = 0;
	const stopListening = await listen(
		channel,
		() => {
			generation++;
			const pending = waiters;
			waiters = new Set();
			for (const resolve of pending) resolve();
		},
		opts,
	);
	return {
		wait: () => new Promise<void>((resolve) => waiters.add(resolve)),
		generation: () => generation,
		stop: async () => {
			const pending = waiters;
			waiters = new Set();
			for (const resolve of pending) resolve();
			await stopListening();
		},
	};
}

export async function notify(
	channel: string,
	payload?: string,
	opts?: ListenOptions,
): Promise<void> {
	const client = postgres(resolveUrl(opts), { max: 1 });

	try {
		if (payload) {
			await client`SELECT pg_notify(${channel}, ${payload})`;
		} else {
			await client`SELECT pg_notify(${channel}, '')`;
		}
	} finally {
		await client.end();
	}
}
