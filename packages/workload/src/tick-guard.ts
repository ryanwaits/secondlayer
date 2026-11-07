/** Wraps an interval callback so a tick that fires while the previous one is
 *  still running is skipped, not run alongside it. `setInterval` does not wait
 *  for an async callback, so a slow round (a long compose call) would
 *  otherwise overlap the next one and double-act on the same tenants. */
export function skipWhileRunning(
	tick: () => Promise<void>,
	onSkip: () => void = () => {},
): () => Promise<void> {
	let running = false;
	return async () => {
		if (running) {
			onSkip();
			return;
		}
		running = true;
		try {
			await tick();
		} finally {
			running = false;
		}
	};
}
