/**
 * Shared bookkeeping for the dashboard stores' refreshers. Two screens (or a
 * screen and the account menu) asking for the same read at once share one
 * request. Nothing is remembered once a read settles: pages render their data
 * on the server, so there is no replay window to keep.
 */
const inflight = new Map<string, Promise<unknown>>();

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

/** Forget everything (sign-out, tests). */
export function clearRequestCache(): void {
	inflight.clear();
}
