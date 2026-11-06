/**
 * A flag that holds a client read back while an account route is still
 * streaming the data that would make the read unnecessary. `begin` is quiet
 * (it runs while a component renders); `end` bumps an epoch and wakes
 * subscribers, so a reader that never rendered while the flag was up still
 * re-runs its effect and decides again.
 */
export function createHold() {
	let active = false;
	let epoch = 0;
	const listeners = new Set<() => void>();
	return {
		begin() {
			active = true;
		},
		end() {
			active = false;
			epoch++;
			for (const l of listeners) l();
		},
		active: () => active,
		epoch: () => epoch,
		subscribe(l: () => void) {
			listeners.add(l);
			return () => {
				listeners.delete(l);
			};
		},
	};
}
