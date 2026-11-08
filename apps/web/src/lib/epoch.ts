/**
 * A store's guard against late reads. `mark()` before a read; the returned
 * check is false once `bump()` ran (sign-out, another account), so a read
 * that began for the old account never fills the next account's store.
 */
export function createEpoch() {
	let epoch = 0;
	return {
		bump(): void {
			epoch++;
		},
		mark(): () => boolean {
			const started = epoch;
			return () => started === epoch;
		},
	};
}

/** Wakes every listener. `deferred` waits a microtask, for a clear that runs
 *  while a component renders (React forbids waking other components then). */
export function notifyAll(
	listeners: ReadonlySet<() => void>,
	deferred = false,
): void {
	const wake = () => {
		for (const l of listeners) l();
	};
	if (deferred) queueMicrotask(wake);
	else wake();
}
