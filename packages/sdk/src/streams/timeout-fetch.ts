import { StreamsServerError } from "./errors.ts";
import type { FetchLike } from "./types.ts";

/** Default for connecting and receiving response headers. Matches the other
 *  SDK clients' request budget. */
export const STREAMS_CONNECT_TIMEOUT_MS = 30_000;

/**
 * Wrap `fetchImpl` so connecting and receiving response headers is bounded by
 * `timeoutMs`. The timer covers headers only: once they arrive it is cleared,
 * so a long-lived SSE body is never cut off by it (the stale timer owns
 * that). A timeout rejects with a retryable `StreamsServerError` so every
 * reconnect/retry path treats it like any other transport failure; a caller
 * abort still rejects with the caller's own reason. `0` or a non-finite value
 * disables the bound.
 */
export function withConnectTimeout(
	fetchImpl: FetchLike,
	timeoutMs: number,
): FetchLike {
	if (!(timeoutMs > 0) || !Number.isFinite(timeoutMs)) return fetchImpl;
	return async (input, init) => {
		const callerSignal = init?.signal ?? undefined;
		const timeout = new AbortController();
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			timeout.abort();
		}, timeoutMs);
		const signal = callerSignal
			? AbortSignal.any([callerSignal, timeout.signal])
			: timeout.signal;
		try {
			return await fetchImpl(input, { ...init, signal });
		} catch (err) {
			if (timedOut && !callerSignal?.aborted) {
				throw new StreamsServerError(
					`No response headers within ${timeoutMs}ms. Retryable.`,
					0,
					undefined,
					"REQUEST_TIMEOUT",
				);
			}
			throw err;
		} finally {
			clearTimeout(timer);
		}
	};
}
