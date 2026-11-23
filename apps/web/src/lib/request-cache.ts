/**
 * Nothing is remembered once a read settles: pages render their data on the
 * server, so there is no replay window to keep.
 */
const inflight = new Map<string, Promise<unknown>>();

export function shared<T>(key: string, run: () => Promise<T>): Promise<T> {
	const existing = inflight.get(key);
	if (existing) return existing as Promise<T>;
	const promise = run().finally(() => {
		if (inflight.get(key) === promise) inflight.delete(key);
	});
	inflight.set(key, promise);
	return promise;
}

export function clearRequestCache(): void {
	inflight.clear();
}
