import postgres from "postgres";
import { resolveSourceUrl, resolveTargetUrl } from "../db/index.ts";

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

export async function listen(
	channel: string,
	callback: (payload?: string) => void,
	opts?: ListenOptions,
): Promise<() => Promise<void>> {
	const client = postgres(resolveUrl(opts), {
		max: 1,
		onnotice: () => {},
	});

	await client.listen(channel, (payload) => {
		callback(payload);
	});

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
	const stopListening = await listen(
		channel,
		() => {
			const pending = waiters;
			waiters = new Set();
			for (const resolve of pending) resolve();
		},
		opts,
	);
	return {
		wait: () => new Promise<void>((resolve) => waiters.add(resolve)),
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
