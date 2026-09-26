/**
 * Index long-poll. A request that names `wait` (seconds) holds
 * the connection open instead of answering immediately when it has nothing
 * new to report, and is woken the moment ANY decoder checkpoint commits
 * (`index:tip` NOTIFY, emitted from `writeCheckpoint` in
 * `@secondlayer/shared/coverage/adapter.ts`) or `wait` elapses, whichever
 * comes first. The caller then re-reads the tip and answers normally either
 * way — this module owns only the "how long to hold" part.
 *
 * Waking on ANY decoder's commit (not just the ones a given request reads) is
 * a deliberate simplification: re-checking is cheap, and precise per-decoder
 * routing would need every waiter to declare its decoder set up front. A
 * request whose own decoders haven't moved just finds nothing new, races the
 * remaining budget again, and answers on timeout — never wrong, just an
 * occasional spurious wake.
 */

import { describeDbUrl } from "@secondlayer/shared/db";
import { ValidationError } from "@secondlayer/shared/errors";
import { MAX_INDEX_WAIT_SECONDS } from "@secondlayer/shared/index-http";
import { logger } from "@secondlayer/shared/logger";
import {
	type WakeBus,
	createWakeBus,
	sourceListenerUrl,
} from "@secondlayer/shared/queue/listener";

export { MAX_INDEX_WAIT_SECONDS };

/** Parse the `wait` query param (seconds). `undefined`/absent means "don't
 *  wait" — every existing caller that never sends it keeps today's behavior
 *  exactly. Out-of-range or non-integer values are refused loudly rather than
 *  silently clamped, so a caller misusing the param finds out immediately. */
export function parseWaitSeconds(
	value: string | undefined,
): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0) {
		throw new ValidationError("wait must be a non-negative integer (seconds)");
	}
	if (parsed > MAX_INDEX_WAIT_SECONDS) {
		throw new ValidationError(
			`wait must be at most ${MAX_INDEX_WAIT_SECONDS} seconds`,
		);
	}
	return parsed;
}

let wakeBus: WakeBus | null = null;
let starting: Promise<void> | null = null;

/**
 * Start (once per process) the LISTEN backing every pending long-poll. Safe
 * to call more than once — only the first call opens a connection. Degrades
 * safely: if it never connects (or the connection later drops), every
 * `waitForIndexTipAdvance` call just waits out its full timeout instead of
 * waking early — still correct, just not sped up.
 */
export function startIndexTipWakeListener(opts?: {
	connectionString?: string;
}): void {
	if (wakeBus || starting) return;
	const url = opts?.connectionString ?? sourceListenerUrl();
	starting = createWakeBus("index:tip", { connectionString: url })
		.then((bus) => {
			wakeBus = bus;
			// Names the channel + the exact host/db LISTENed on (no credentials)
			// so a split-DB misconfiguration is visible in `docker logs` at boot.
			logger.info("Index tip wake listener connected", {
				channel: "index:tip",
				db: describeDbUrl(url),
			});
		})
		.catch((error) => {
			logger.warn(
				"Index tip wake listener failed to start — long-polls will always wait out their full `wait` timeout instead of waking early",
				{
					channel: "index:tip",
					db: describeDbUrl(url),
					error: error instanceof Error ? error.message : String(error),
				},
			);
		})
		.finally(() => {
			starting = null;
		});
}

/** The wake bus's current generation counter, or 0 when it hasn't connected
 *  (yet, or ever). Exported so a long-poll loop can record "the generation as
 *  of just before this build()" and later tell whether a NOTIFY landed since —
 *  see `waitForIndexTipAdvance`'s `sinceGeneration`. */
export function currentIndexTipGeneration(): number {
	return wakeBus?.generation() ?? 0;
}

/** Wait for the next decoder-checkpoint commit, or `seconds` elapsing —
 *  whichever comes first. `undefined`/`0` resolves immediately (no wait
 *  requested). Never rejects: a wake bus that failed to start (or hasn't
 *  finished starting yet) just falls back to the plain timeout.
 *
 *  `sinceGeneration`, when given, closes the check-then-wait race: if the
 *  wake bus's generation has already advanced past it, a commit happened
 *  since the caller last checked (most likely while it was inside `build()`,
 *  reading now-stale state), and a freshly registered `wait()` would only
 *  resolve on a FUTURE notify — so this returns immediately instead of
 *  waiting out the remaining budget or a second commit that may never come
 *  before the next block. */
export async function waitForIndexTipAdvance(
	seconds: number | undefined,
	sinceGeneration?: number,
): Promise<void> {
	if (!seconds || seconds <= 0) return;
	if (
		sinceGeneration !== undefined &&
		wakeBus &&
		wakeBus.generation() !== sinceGeneration
	) {
		return;
	}
	const ms = Math.min(MAX_INDEX_WAIT_SECONDS, seconds) * 1000;
	await new Promise<void>((resolve) => {
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(finish, ms);
		(wakeBus?.wait() ?? new Promise<void>(() => {})).then(finish);
	});
}

/**
 * Long-poll wrapper: run `build` (which must re-fetch the tip fresh — a
 * stale one would just report "still empty" forever) and, while `isEmpty`
 * says there's nothing new, wait for a wake or the remaining budget, then
 * retry, until `waitSeconds` (clamped) has elapsed or the caller stops
 * looking empty. Immediate (no wait) when `waitSeconds` is unset or 0.
 *
 * The generation is recorded BEFORE each `build()`, not after — a commit can
 * land while `build()` itself is running (e.g. reading a tip cache moments
 * before its invalidation), and that must count as "already advanced" too.
 */
export async function longPollIndex<T>(opts: {
	waitSeconds: number | undefined;
	isEmpty: (result: T) => boolean;
	build: () => Promise<T>;
}): Promise<T> {
	const totalMs =
		Math.min(MAX_INDEX_WAIT_SECONDS, Math.max(0, opts.waitSeconds ?? 0)) * 1000;
	let generation = currentIndexTipGeneration();
	let result = await opts.build();
	if (totalMs <= 0) return result;

	const deadline = Date.now() + totalMs;
	while (opts.isEmpty(result) && Date.now() < deadline) {
		const remainingSeconds = (deadline - Date.now()) / 1000;
		await waitForIndexTipAdvance(remainingSeconds, generation);
		generation = currentIndexTipGeneration();
		result = await opts.build();
	}
	return result;
}
