import {
	type LeaderBackend,
	SUBGRAPH_CATCHUP_LOCK_KEY,
	createPostgresLeaderBackend,
	withLeaderLock,
} from "@secondlayer/shared/leader";
import { targetListenerUrl } from "@secondlayer/shared/queue/listener";

/**
 * Leader-gating for the subgraph catch-up driver.
 *
 * Catch-up runs on every NOTIFY/poll guarded only by an in-process Set, so 2+
 * processors would otherwise double-process every block. That is NOT safe by
 * default: handler writes go through `ctx.increment` (additive), which is
 * replay-sensitive, not idempotent — two processors committing the same
 * block's deltas corrupts an accumulator table exactly the way the f068
 * investigation found in production
 * (`docs/internal/audits/asset-holdings-unreproducible-balances-f068.md`).
 * Electing a single catch-up leader is still the right design (it avoids the
 * wasted CPU/DB of redundant walks), but the actual overlap-safety net is the
 * live path's conditional cursor advance (`block-processor.ts`,
 * `recordLiveProgress` in `packages/shared/src/db/queries/subgraphs.ts`;
 * f069) plus the per-iteration leadership check in `catchup.ts`'s walk loop —
 * a walker that loses its lease now stops promptly, and even if it didn't,
 * its writes could no longer win a same-height race against a newer leader's
 * commit. The in-process Set stays as the within-process guard; this lock is
 * the cross-process guard; the conditional advance is the correctness
 * guarantee that holds even if both of those are ever bypassed.
 *
 * The lock lives on the target DB — the `subgraphs` table and per-subgraph
 * cursors are control-plane state homed there by the source/target split.
 */

let catchUpLeader = false;

/** True only on the process currently holding the catch-up leader lock. */
export function isCatchUpLeader(): boolean {
	return catchUpLeader;
}

export type StartCatchUpLeaderOptions = {
	pollMs?: number;
	heartbeatMs?: number;
	/** Injectable for tests; defaults to the real Postgres backend on target. */
	createBackend?: () => LeaderBackend;
	/** Run once when leadership is acquired — e.g. an immediate catch-up so the
	 *  new leader doesn't wait a poll interval to start. */
	onAcquire?: () => void | Promise<void>;
};

/**
 * Acquire and hold the catch-up leader lock. Returns a stop function that ends
 * election and releases the lock. While held, `isCatchUpLeader()` is true so the
 * NOTIFY/poll/startup catch-up paths actually run work.
 */
export function startCatchUpLeader(
	opts: StartCatchUpLeaderOptions = {},
): () => Promise<void> {
	return withLeaderLock(
		SUBGRAPH_CATCHUP_LOCK_KEY,
		async () => {
			catchUpLeader = true;
			await opts.onAcquire?.();
			return () => {
				catchUpLeader = false;
			};
		},
		{
			pollMs: opts.pollMs,
			heartbeatMs: opts.heartbeatMs,
			createBackend:
				opts.createBackend ??
				(() => createPostgresLeaderBackend(targetListenerUrl())),
		},
	);
}
