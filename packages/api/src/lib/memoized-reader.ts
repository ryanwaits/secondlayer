/**
 * Run `read` at most once per `ttlMs`, one refresh at a time; null when no
 * usable value exists.
 *
 * - Fresh (< `ttlMs`): the cached value, no read.
 * - Stale (< `staleMs`): the cached value immediately while one refresh runs in
 *   the background. A failed refresh keeps the old value.
 * - Nothing usable: wait for the refresh, but at most `waitMs`, then null. A
 *   refresh that outlives the wait still fills the cache when it finishes.
 */
export function createMemoizedReader<T>(
	read: () => Promise<T>,
	{
		now = Date.now,
		ttlMs = 60_000,
		staleMs = ttlMs,
		waitMs = 10_000,
		onError,
	}: {
		now?: () => number;
		ttlMs?: number;
		staleMs?: number;
		waitMs?: number;
		onError?: (error: unknown) => void;
	} = {},
): () => Promise<T | null> {
	let cached: { at: number; value: T } | null = null;
	let inflight: Promise<T | null> | null = null;

	const refresh = (): Promise<T | null> => {
		if (inflight) return inflight;
		inflight = (async () => read())()
			.then(
				(value): T | null => {
					cached = { at: now(), value };
					return value;
				},
				(error): T | null => {
					onError?.(error);
					return null;
				},
			)
			.finally(() => {
				inflight = null;
			});
		return inflight;
	};

	return () => {
		const age = cached ? now() - cached.at : Number.POSITIVE_INFINITY;
		if (cached && age < ttlMs) return Promise.resolve(cached.value);
		const pending = refresh();
		if (cached && age < staleMs) return Promise.resolve(cached.value);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<null>((resolve) => {
			timer = setTimeout(() => resolve(null), waitMs);
		});
		return Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
	};
}
