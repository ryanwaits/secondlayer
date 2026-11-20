/**
 * Abortable sleep. Detaches its abort listener on the timer path too: the
 * decode loops sleep on a process-long signal once per empty poll, so a
 * listener left behind would pin a closure until the process exited.
 */
export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return;
	await new Promise<void>((resolve) => {
		const onAbort = () => {
			clearTimeout(timeout);
			resolve();
		};
		const timeout = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
