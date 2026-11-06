// Server-only: per-request time budget for an account page's reads.
import { cache } from "react";

/** How long a request waits for its data before it sends what it has. Inside
 *  it the page arrives as one complete paint; past it the frame and a skeleton
 *  go out and the data streams in behind them. */
export const HEAD_START_MS = 300;

export type HeadStart<T> =
	| { ready: true; value: T }
	| { ready: false; pending: Promise<T> };

interface Clock {
	now(): number;
	sleep(ms: number): { done: Promise<void>; cancel(): void };
}

const realClock: Clock = {
	now: () => performance.now(),
	sleep(ms) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const done = new Promise<void>((resolve) => {
			timer = setTimeout(resolve, ms);
		});
		return { done, cancel: () => clearTimeout(timer) };
	},
};

/** Resolves to the value if `promise` settles before `deadline` (on the
 *  clock's timeline), else to the promise itself, still running. */
export async function raceDeadline<T>(
	promise: Promise<T>,
	deadline: number,
	clock: Clock = realClock,
): Promise<HeadStart<T>> {
	const wait = clock.sleep(Math.max(0, deadline - clock.now()));
	try {
		return await Promise.race([
			promise.then((value): HeadStart<T> => ({ ready: true, value })),
			wait.done.then((): HeadStart<T> => ({ ready: false, pending: promise })),
		]);
	} finally {
		wait.cancel();
	}
}

/** The moment this request's budget runs out. The first call in a request
 *  starts the clock, so a layout and its page share one budget. */
export const requestDeadline = cache(
	(): number => realClock.now() + HEAD_START_MS,
);

/** Waits for `promise` only as long as the request's budget has left. */
export function headStart<T>(promise: Promise<T>): Promise<HeadStart<T>> {
	return raceDeadline(promise, requestDeadline());
}
