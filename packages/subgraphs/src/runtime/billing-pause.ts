import type { getTargetDb } from "@secondlayer/shared/db";
import {
	clearSubgraphBillingPaused,
	markSubgraphBillingPaused,
} from "@secondlayer/shared/db/queries/subgraphs";
import { BillingPausedError } from "@secondlayer/shared/index-http";
import { logger } from "@secondlayer/shared/logger";

/**
 * A hosted account past its free rows is refused with `402` (spend cap reached
 * or credits short). That is a deliberate billing state, not a failing
 * subgraph: the walk waits, records the code in `billing_paused_code` (and
 * `billing_paused_at`), and resumes from its cursor once reads succeed. It
 * never counts toward an error threshold, never touches `last_error`, and
 * never marks the subgraph `error`.
 */
export const BILLING_PAUSE_BACKOFF_MS = 60_000;

type Db = ReturnType<typeof getTargetDb>;

/** A subgraph row: writes match its id, logs carry its name. */
export interface SubgraphRef {
	id: string;
	name: string;
}

/** Subgraph id -> epoch ms before which catch-up should not re-check. */
const backoffUntil = new Map<string, number>();

export function inBillingBackoff(
	subgraphId: string,
	now = Date.now(),
): boolean {
	return (backoffUntil.get(subgraphId) ?? 0) > now;
}

/** Record the pause and start the backoff window. */
export async function recordBillingPause(
	db: Db,
	subgraph: SubgraphRef,
	err: BillingPausedError,
	backoffMs = BILLING_PAUSE_BACKOFF_MS,
): Promise<void> {
	backoffUntil.set(subgraph.id, Date.now() + backoffMs);
	logger.warn("Subgraph paused: reads refused for billing", {
		event: "subgraph_billing_paused",
		subgraph: subgraph.name,
		code: err.code,
		retryInMs: backoffMs,
	});
	await markSubgraphBillingPaused(db, subgraph.id, err.code).catch(() => {});
}

/** Reads succeeded again: drop the backoff and the recorded code. */
export async function clearBillingPause(
	db: Db,
	subgraph: SubgraphRef,
): Promise<void> {
	backoffUntil.delete(subgraph.id);
	await clearSubgraphBillingPaused(db, subgraph.id).catch(() => {});
}

function sleepUnlessAborted(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) return resolve();
		const done = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", done);
			resolve();
		};
		const timer = setTimeout(done, ms);
		signal?.addEventListener("abort", done, { once: true });
	});
}

/**
 * Await a batch load, and while it is refused for billing: record the pause,
 * back off, and reload. Returns `undefined` only if `signal` aborts during the
 * wait. Any other error propagates unchanged.
 */
export async function loadWhileBillingPaused<T>(
	db: Db,
	subgraph: SubgraphRef,
	first: Promise<T>,
	reload: () => Promise<T>,
	opts: { signal?: AbortSignal; backoffMs?: number } = {},
): Promise<T | undefined> {
	const backoffMs = opts.backoffMs ?? BILLING_PAUSE_BACKOFF_MS;
	let attempt = first;
	let paused = false;
	for (;;) {
		try {
			const value = await attempt;
			if (paused) await clearBillingPause(db, subgraph);
			return value;
		} catch (err) {
			if (!(err instanceof BillingPausedError)) throw err;
			paused = true;
			await recordBillingPause(db, subgraph, err, backoffMs);
			await sleepUnlessAborted(backoffMs, opts.signal);
			if (opts.signal?.aborted) return undefined;
			attempt = reload();
		}
	}
}
