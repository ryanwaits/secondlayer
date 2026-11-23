const inFlight = new Set<Promise<unknown>>();

/**
 * Run `tick` once after `firstTickMs`, then every `intervalMs`. Returns the
 * stop function. Every run is tracked so shutdown can wait for it with
 * {@link settleInFlightTicks} instead of cutting a tick off mid-write.
 */
export function scheduleCron(
	tick: () => Promise<unknown>,
	firstTickMs: number,
	intervalMs: number,
): () => void {
	const run = () => {
		const pending = tick().catch(() => {});
		inFlight.add(pending);
		pending.finally(() => inFlight.delete(pending));
	};
	const initial = setTimeout(run, firstTickMs);
	const interval = setInterval(run, intervalMs);
	return () => {
		clearTimeout(initial);
		clearInterval(interval);
	};
}

export async function settleInFlightTicks(timeoutMs = 10_000): Promise<number> {
	if (inFlight.size === 0) return 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timedOut = new Promise<"timeout">((resolve) => {
		timer = setTimeout(() => resolve("timeout"), timeoutMs);
	});
	const settled = Promise.allSettled([...inFlight]).then(() => "settled");
	try {
		await Promise.race([settled, timedOut]);
	} finally {
		clearTimeout(timer);
	}
	return inFlight.size;
}

export function resetInFlightTicksForTests(): void {
	inFlight.clear();
}
