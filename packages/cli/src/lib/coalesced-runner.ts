/** `idle` = nothing running; `deploying` = one run in flight; `deployingDirty`
 *  = a trigger arrived mid-run, so one more run follows once it settles. */
export type RunnerState = "idle" | "deploying" | "deployingDirty";

/**
 * Run `task` one at a time. Triggers that arrive while it runs collapse into a
 * single re-run after it settles, so a burst of saves deploys at most twice
 * and never overlaps. `task` must not throw; a throw is swallowed so the
 * runner always returns to `idle`.
 */
export function createCoalescedRunner(task: () => Promise<void>): {
	trigger: () => Promise<void>;
	state: () => RunnerState;
} {
	let state: RunnerState = "idle";

	const trigger = async (): Promise<void> => {
		if (state !== "idle") {
			state = "deployingDirty";
			return;
		}
		do {
			state = "deploying";
			try {
				await task();
			} catch {
				// The task reports its own failures; keep the runner usable.
			}
		} while ((state as RunnerState) === "deployingDirty");
		state = "idle";
	};

	return { trigger, state: () => state };
}
