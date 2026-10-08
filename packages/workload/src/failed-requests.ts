/**
 * Buffered shipper for the gateway's failed-request records. The gateway
 * records synchronously (never delaying or failing a customer response); a
 * background flush POSTs batches to app-server's `/internal/failed-requests`.
 * Records are feedback evidence, not billing: a full buffer drops the oldest
 * row and a failed flush drops that batch.
 */

import { logger } from "@secondlayer/shared";
import type { FailedRequestRecord } from "@secondlayer/shared/error-envelope";
import type { FetchLike } from "./fetch-like.ts";

export interface FailedRequestRecorderConfig {
	appServerUrl: string;
	workloadHostKey: string;
	fetchImpl?: FetchLike;
	/** Default 5000. */
	flushIntervalMs?: number;
	/** Rows per POST, and the buffered size that triggers an early flush.
	 *  Default 50. */
	maxBatch?: number;
	/** Default 1000. */
	maxBuffer?: number;
	/** Clock for the warn throttle. */
	now?: () => number;
}

const WARN_THROTTLE_MS = 60_000;

export interface FailedRequestRecorder {
	/** Sync, never throws; flushes in the background at `maxBatch`. */
	record(row: FailedRequestRecord): void;
	/** Sends up to `maxBatch` per POST until empty; swallows errors. */
	flush(): Promise<void>;
	/** Starts the interval flush; the returned stop clears it and resolves after the final flush. */
	start(): () => Promise<void>;
	size(): number;
}

export function createFailedRequestRecorder(
	cfg: FailedRequestRecorderConfig,
): FailedRequestRecorder {
	const flushIntervalMs = cfg.flushIntervalMs ?? 5000;
	const maxBatch = cfg.maxBatch ?? 50;
	const maxBuffer = cfg.maxBuffer ?? 1000;
	const now = cfg.now ?? Date.now;
	const doFetch = cfg.fetchImpl ?? fetch;
	const url = `${cfg.appServerUrl.replace(/\/+$/, "")}/internal/failed-requests`;

	const buffer: FailedRequestRecord[] = [];
	let flushing = false;
	let lastWarnAt = Number.NEGATIVE_INFINITY;

	function warn(status: number | undefined): void {
		const t = now();
		if (t - lastWarnAt < WARN_THROTTLE_MS) return;
		lastWarnAt = t;
		logger.warn("workload.failed_requests.flush_failed", { status });
	}

	async function flush(): Promise<void> {
		if (flushing) return;
		flushing = true;
		try {
			while (buffer.length > 0) {
				const items = buffer.splice(0, maxBatch);
				try {
					const res = await doFetch(url, {
						method: "POST",
						headers: {
							"content-type": "application/json",
							authorization: `Bearer ${cfg.workloadHostKey}`,
						},
						body: JSON.stringify({ items }),
					});
					if (!res.ok) warn(res.status);
				} catch {
					warn(undefined);
				}
			}
		} finally {
			flushing = false;
		}
	}

	return {
		record(row) {
			if (buffer.length >= maxBuffer) buffer.shift();
			buffer.push(row);
			if (buffer.length >= maxBatch) void flush();
		},
		flush,
		start() {
			const timer = setInterval(() => void flush(), flushIntervalMs);
			return () => {
				clearInterval(timer);
				return flush();
			};
		},
		size: () => buffer.length,
	};
}
