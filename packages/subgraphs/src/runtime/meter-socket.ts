/**
 * Hosted-stack event meter counter (plan 044, step 5). Counts webhook
 * deliveries (never retries) and pushes the count to the provisioner over a
 * unix socket every 60s. Inert unless `WEBHOOK_METER_SOCKET` is set — a
 * self-host instance never has this env var, so this module is a total
 * no-op there (no socket, no interval, no behavior change).
 *
 * Runs only inside `webhook-processor` (`webhook-service.ts` /
 * `webhook-plane.ts`) — never the subgraph indexer, never `api`. Counts
 * never touch this instance's own Postgres, so once 046 runs customer
 * handler code in `api`, that code has no path to lower them (Design,
 * "Open" section).
 */

import { logger } from "@secondlayer/shared";

const FLUSH_INTERVAL_MS = 60_000;

let pending = 0;
let flushTimer: ReturnType<typeof setInterval> | undefined;

/** Socket path this process pushes to, or `undefined` when the meter is
 *  off (self-host, or hosted before this env is wired). Read once at
 *  `startMeterSocketReporter()` time, not per-call, so a mid-process env
 *  mutation (tests) can't half-apply. */
function socketPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const path = env.WEBHOOK_METER_SOCKET?.trim();
	return path && path.length > 0 ? path : undefined;
}

/** Count one delivered event (never a retry — call this only from the path
 *  that already excludes retries, `emitter.ts`'s `settleDelivered`). A
 *  no-op with zero overhead when the meter is off. */
export function recordDelivery(): void {
	if (!socketPath()) return;
	pending += 1;
}

let flushing = false;

/** Pushes the pending count. It leaves `pending` only once the provisioner
 *  accepted it, so a push that fails (socket not up yet, workload restarting)
 *  is retried on the next flush instead of dropping the events. Events
 *  recorded while a push is in flight stay in `pending` for the next one. */
async function flush(path: string): Promise<void> {
	if (flushing) return;
	const count = pending;
	if (count === 0) return;
	flushing = true;
	try {
		const res = await fetch("http://localhost/", {
			method: "POST",
			body: JSON.stringify({ delivered_events: count }),
			unix: path,
		});
		if (res.ok) {
			pending -= count;
		} else {
			logger.warn("webhook.meter_socket.push_rejected", {
				status: res.status,
				count,
			});
		}
	} catch (err) {
		// The provisioner's socket may not be listening yet (mid-provision) or
		// briefly restarting — never fatal to webhook delivery, which is this
		// process's actual job.
		logger.warn("webhook.meter_socket.push_failed", {
			error: err instanceof Error ? err.message : String(err),
			count,
		});
	} finally {
		flushing = false;
	}
}

/** Starts the 60s flush loop when `WEBHOOK_METER_SOCKET` is set; a no-op
 *  (returns a no-op stop function) otherwise. Idempotent — a second call
 *  while already running clears the previous interval first. */
export function startMeterSocketReporter(): () => void {
	const path = socketPath();
	if (!path) return () => {};

	if (flushTimer) clearInterval(flushTimer);
	flushTimer = setInterval(() => {
		flush(path).catch(() => {}); // flush() already logs; never throw into the timer
	}, FLUSH_INTERVAL_MS);

	return () => {
		if (flushTimer) {
			clearInterval(flushTimer);
			flushTimer = undefined;
		}
	};
}

/** Test-only: reset the module-level counter between test files. */
export function resetMeterSocketCounterForTests(): void {
	pending = 0;
	flushing = false;
}

/** Test-only: run one flush against `path` now. */
export function flushMeterSocketForTests(path: string): Promise<void> {
	return flush(path);
}

/** Test-only: read the current unflushed count. */
export function pendingCountForTests(): number {
	return pending;
}
