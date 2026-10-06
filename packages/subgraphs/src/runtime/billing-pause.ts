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
 * subgraph: the walk waits, records `billing_paused: <code>` on the subgraph's
 * `last_error`, and resumes from its cursor once reads succeed. It never
 * counts toward an error threshold and never marks the subgraph `error`.
 */
export const BILLING_PAUSE_BACKOFF_MS = 60_000;

type Db = ReturnType<typeof getTargetDb>;

/** Subgraph name -> epoch ms before which catch-up should not re-check. */
const backoffUntil = new Map<string, number>();

export function inBillingBackoff(name: string, now = Date.now()): boolean {
	return (backoffUntil.get(name) ?? 0) > now;
}

/** Record the pause and start the backoff window. */
export async function recordBillingPause(
	db: Db,
	name: string,
	err: BillingPausedError,
	backoffMs = BILLING_PAUSE_BACKOFF_MS,
): Promise<void> {
	backoffUntil.set(name, Date.now() + backoffMs);
	logger.warn("Subgraph paused: reads refused for billing", {
		event: "subgraph_billing_paused",
		subgraph: name,
		code: err.code,
		retryInMs: backoffMs,
	});
	await markSubgraphBillingPaused(db, name, err.code).catch(() => {});
}

/** Reads succeeded again: drop the backoff and the recorded code. */
export async function clearBillingPause(db: Db, name: string): Promise<void> {
	backoffUntil.delete(name);
	await clearSubgraphBillingPaused(db, name).catch(() => {});
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
	name: string,
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
			if (paused) await clearBillingPause(db, name);
			return value;
		} catch (err) {
			if (!(err instanceof BillingPausedError)) throw err;
			paused = true;
			await recordBillingPause(db, name, err, backoffMs);
			await sleepUnlessAborted(backoffMs, opts.signal);
			if (opts.signal?.aborted) return undefined;
			attempt = reload();
		}
	}
}
