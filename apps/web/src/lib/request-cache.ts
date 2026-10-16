/**
 * Shared bookkeeping for the dashboard stores' refreshers. Two screens (or a
 * screen and the account menu) asking for the same read at once share one
 * request, and a screen mounting right after another one loaded the same
 * data can skip it. Polls and writes never consult freshness; only mount-time
 * "make sure this is loaded" calls do.
 */
const inflight = new Map<string, Promise<unknown>>();
const settledAt = new Map<string, number>();

/** How long data counts as fresh for a mount-time load. */
export const FRESH_MS = 15_000;

/** Run `run` unless a call with the same key is already in flight, in which case share it. */
export function shared<T>(key: string, run: () => Promise<T>): Promise<T> {
	const existing = inflight.get(key);
	if (existing) return existing as Promise<T>;
	const promise = run().finally(() => {
		if (inflight.get(key) === promise) inflight.delete(key);
	});
	inflight.set(key, promise);
	return promise;
}

/** Record a successful read for `key` (call only when the store was written). */
export function markFresh(key: string): void {
	settledAt.set(key, Date.now());
}

/** Whether `key` was read successfully within `maxAgeMs`. */
export function isFresh(key: string, maxAgeMs = FRESH_MS): boolean {
	const at = settledAt.get(key);
	return at !== undefined && Date.now() - at < maxAgeMs;
}

/** Forget everything (sign-out, tests). */
export function clearRequestCache(): void {
	inflight.clear();
	settledAt.clear();
}
