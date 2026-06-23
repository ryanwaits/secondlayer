import type { Client } from "../../clients/types.ts";
import { BroadcastError } from "../../errors/transaction.ts";
import type { StacksTransaction } from "../../transactions/types.ts";
import { getNonce } from "../public/getNonce.ts";
import { sendTransaction } from "./sendTransaction.ts";

/**
 * Provides the confirmed on-chain nonce floor for an address.
 *
 * The default {@link jsonRpcSource} reads the configured node's `/v2/accounts`
 * endpoint — node-agnostic, no Hiro dependency. Other sources (mempool-aware,
 * first-party Index) can be swapped in without touching the manager.
 */
export type NonceManagerSource = {
	get(params: { client: Client; address: string }): Promise<bigint>;
};

/**
 * Holds per-address allocation state and hands out the next nonce.
 *
 * `reserve` MUST be atomic per `key`: two concurrent reservations for the same
 * key must never return the same value. The in-memory {@link memoryStore}
 * serializes with a per-key promise chain; a persisted store (Redis `INCR`,
 * Postgres `SELECT ... FOR UPDATE`) becomes the cross-process lock for the
 * multi-builder / smart-wallet-as-a-service case.
 */
export type NonceStore = {
	/**
	 * Reserve the next nonce for `key`. `getFloor` reads the confirmed on-chain
	 * nonce; it is only invoked when the store has no tracked value (cold start
	 * or after {@link NonceStore.reset}).
	 */
	reserve(key: string, getFloor: () => Promise<bigint>): Promise<bigint>;
	/** Forget tracked state for `key` so the next reserve re-syncs from the floor. */
	reset(key: string): void | Promise<void>;
	/**
	 * Return the next nonce that {@link NonceStore.reserve} would hand out for
	 * `key` WITHOUT consuming it, or `undefined` if `key` is untracked. Used by
	 * {@link reconcileNonce} to detect drift. Optional — stores that omit it
	 * simply opt out of reconciliation.
	 */
	peek?(key: string): Promise<bigint | undefined> | bigint | undefined;
};

/** Allocates mempool-safe sequential nonces across rapid broadcasts from one account. */
export type NonceManager = {
	consume(params: { client: Client; address: string }): Promise<bigint>;
	reset(params: { client: Client; address: string }): void | Promise<void>;
	/** Next nonce that {@link NonceManager.consume} would return without consuming it, or `undefined` if untracked. */
	peek(params: {
		client: Client;
		address: string;
	}): Promise<bigint | undefined>;
};

export type CreateNonceManagerParams = {
	source?: NonceManagerSource;
	store?: NonceStore;
};

/** Confirmed-nonce source backed by the configured node's `/v2/accounts` RPC (no Hiro dependency). */
export function jsonRpcSource(): NonceManagerSource {
	return {
		get: ({ client, address }) => getNonce(client, { address }),
	};
}

/**
 * In-memory, single-process store. Tracks the next nonce per key and serializes
 * concurrent reservations with a per-key promise chain.
 *
 * Correct only within one process — swap in a persisted store for multi-process
 * deployments that share a signing key.
 */
export function memoryStore(): NonceStore {
	const next = new Map<string, bigint>();
	const locks = new Map<string, Promise<unknown>>();

	function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
		const prev = locks.get(key) ?? Promise.resolve();
		// Chain onto the prior reservation regardless of how it settled, so a
		// rejected reserve never wedges the key.
		const run = prev.then(fn, fn);
		locks.set(
			key,
			run.catch(() => {}),
		);
		return run;
	}

	return {
		reserve(key, getFloor) {
			return withLock(key, async () => {
				let current = next.get(key);
				if (current === undefined) current = await getFloor();
				next.set(key, current + 1n);
				return current;
			});
		},
		reset(key) {
			next.delete(key);
		},
		peek(key) {
			return next.get(key);
		},
	};
}

function nonceKey(client: Client, address: string): string {
	return `${client.chain?.id ?? "stacks"}:${address}`;
}

/**
 * Create a nonce manager that floors on a confirmed-nonce {@link NonceManagerSource}
 * and increments a {@link NonceStore} on every {@link NonceManager.consume}.
 *
 * Defaults to {@link jsonRpcSource} + {@link memoryStore} — node-agnostic,
 * single-process, zero external dependencies.
 */
export function createNonceManager(
	params: CreateNonceManagerParams = {},
): NonceManager {
	const source = params.source ?? jsonRpcSource();
	const store = params.store ?? memoryStore();

	return {
		consume({ client, address }) {
			return store.reserve(nonceKey(client, address), () =>
				source.get({ client, address }),
			);
		},
		reset({ client, address }) {
			return store.reset(nonceKey(client, address));
		},
		async peek({ client, address }) {
			return store.peek?.(nonceKey(client, address));
		},
	};
}

/** Resolve the next nonce via the client's nonce manager, falling back to a confirmed read. */
export async function resolveNonce(
	client: Client,
	address: string,
): Promise<bigint> {
	if (client.nonceManager)
		return client.nonceManager.consume({ client, address });
	return getNonce(client, { address });
}

export type ReconcileNonceParams = {
	client: Client;
	address: string;
	/** Authoritative (ideally mempool-aware) source to reconcile against. */
	source: NonceManagerSource;
	/**
	 * Allow resetting DOWNWARD when the source's next nonce is below what the
	 * store tracks — i.e. a previously-allocated tx is no longer pending or
	 * confirmed (dropped/GC'd), so its nonce should be reused. Default `true`.
	 *
	 * Downward resets rely on `source` being current: with a go-forward mempool
	 * source that lags broadcast, run reconciliation on an interval comfortably
	 * longer than mempool propagation so a still-missing tx is genuinely dropped.
	 * Set `false` for upward-only reconciliation (always safe).
	 */
	downward?: boolean;
};

export type ReconcileNonceResult = {
	/** Whether the manager was reset (drift detected). */
	reset: boolean;
	/** Authoritative next nonce from `source`. */
	authoritative: bigint;
	/** Next nonce the store tracked, or `undefined` if untracked. */
	tracked: bigint | undefined;
};

/**
 * Reconcile a tracked nonce against an authoritative source, healing silent
 * drift that produces no broadcast error (a dropped/GC'd mempool tx leaving the
 * counter overshot, or the chain advancing past the local view).
 *
 * When the source's next nonce differs from the tracked value, the manager is
 * {@link NonceManager.reset}; the next `consume` re-seeds from `source`. A no-op
 * if the store is untracked or does not implement `peek`.
 */
export async function reconcileNonce(
	manager: NonceManager,
	params: ReconcileNonceParams,
): Promise<ReconcileNonceResult> {
	const { client, address, source } = params;
	const downward = params.downward ?? true;

	const authoritative = await source.get({ client, address });
	const tracked = await manager.peek({ client, address });

	if (tracked === undefined || authoritative === tracked) {
		return { reset: false, authoritative, tracked };
	}
	if (authoritative < tracked && !downward) {
		return { reset: false, authoritative, tracked };
	}

	await manager.reset({ client, address });
	return { reset: true, authoritative, tracked };
}

export type StartNonceReconcilerParams = {
	client: Client;
	addresses: string[];
	source: NonceManagerSource;
	/** Reconcile interval in ms. Default 60_000. Keep well above mempool propagation. */
	intervalMs?: number;
	downward?: boolean;
	/** Per-address callback after each reconcile (observability). */
	onReconcile?: (address: string, result: ReconcileNonceResult) => void;
	/** Per-address error callback; reconciliation continues on the next tick. */
	onError?: (address: string, error: unknown) => void;
};

/**
 * Run {@link reconcileNonce} on a timer for a set of addresses.
 *
 * SINGLE-WRITER: run this in exactly ONE process. With a shared persisted store,
 * a reconciler resetting the counter while other workers allocate is racy — keep
 * reconciliation on one designated process and let the others only allocate.
 *
 * Returns a handle; call `stop()` to clear the timer.
 */
export function startNonceReconciler(
	manager: NonceManager,
	params: StartNonceReconcilerParams,
): { stop: () => void } {
	const { client, addresses, source } = params;
	const intervalMs = params.intervalMs ?? 60_000;

	const tick = async () => {
		for (const address of addresses) {
			try {
				const result = await reconcileNonce(manager, {
					client,
					address,
					source,
					downward: params.downward,
				});
				params.onReconcile?.(address, result);
			} catch (error) {
				params.onError?.(address, error);
			}
		}
	};

	const timer = setInterval(tick, intervalMs);
	// Don't keep the event loop alive solely for reconciliation (Node/Bun).
	(timer as { unref?: () => void }).unref?.();

	return {
		stop: () => clearInterval(timer),
	};
}

/** True when a broadcast was rejected for a nonce conflict (`ConflictingNonceInMempool`, `BadNonce`). */
export function isNonceConflictError(error: unknown): boolean {
	if (!(error instanceof BroadcastError)) return false;
	const haystack = `${error.reason ?? ""} ${error.message}`.toLowerCase();
	return haystack.includes("nonce");
}

/**
 * Broadcast a signed transaction; on a nonce-conflict rejection, reset the
 * manager so the next build re-syncs to the confirmed floor.
 */
export async function broadcastWithNonceReset(
	client: Client,
	params: { transaction: StacksTransaction; address: string },
): Promise<string> {
	try {
		const result = await sendTransaction(client, {
			transaction: params.transaction,
		});
		return result.txid;
	} catch (error) {
		if (client.nonceManager && isNonceConflictError(error)) {
			await client.nonceManager.reset({ client, address: params.address });
		}
		throw error;
	}
}
