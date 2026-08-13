import { statfs } from "node:fs/promises";

/**
 * Free-space guard for bulk archive jobs.
 *
 * Twice on 2026-08-12 a bulk job filled the disk that production Postgres
 * shares: a backfill died at 9.2M/14.4M rows on ENOSPC, and a restore died at
 * 86% of events. Prod survived both, but only just — 2.9GB free with the
 * indexer still ingesting.
 *
 * The failure mode that makes this worth guarding rather than monitoring: the
 * nightly `pg_basebackup` transiently consumes ~150GB, so a job that starts
 * with comfortable headroom can still hit the wall an hour later. Checking
 * once at startup is not enough; the check has to be repeated as the job runs.
 *
 * Waiting is the right response, not failing. The spike passes, and an
 * archive job that pauses for twenty minutes is strictly better than one that
 * dies at 86% or, worse, takes the database down with it.
 */

export type DiskSpace = { freeBytes: number; totalBytes: number };

export async function readDiskSpace(path: string): Promise<DiskSpace> {
	const stats = await statfs(path);
	return {
		freeBytes: stats.bavail * stats.bsize,
		totalBytes: stats.blocks * stats.bsize,
	};
}

export type DiskGuardOptions = {
	/** Any path on the filesystem to watch. */
	path: string;
	/** Pause below this many bytes free. */
	minFreeBytes?: number;
	/** How long to wait between re-checks while paused. */
	pollMs?: number;
	/** Give up after this long rather than pausing forever. */
	maxWaitMs?: number;
	onPause?: (free: DiskSpace, waitedMs: number) => void;
	sleep?: (ms: number) => Promise<void>;
	readSpace?: (path: string) => Promise<DiskSpace>;
};

/** 100GB: comfortably above the ~39GB an export needs plus the backup spike. */
const DEFAULT_MIN_FREE_BYTES = 100 * 1024 ** 3;
const DEFAULT_POLL_MS = 60_000;
const DEFAULT_MAX_WAIT_MS = 2 * 3_600_000;

export class DiskSpaceExhausted extends Error {
	constructor(free: number, required: number, waitedMs: number) {
		super(
			`only ${(free / 1024 ** 3).toFixed(1)}GB free (need ${(required / 1024 ** 3).toFixed(1)}GB) after waiting ${Math.round(waitedMs / 60_000)}m`,
		);
		this.name = "DiskSpaceExhausted";
	}
}

/**
 * Block until there is enough headroom, or throw after `maxWaitMs`.
 *
 * Call this between units of work — before each partition, not once at the
 * start — because the pressure that matters arrives mid-job.
 */
export async function waitForDiskSpace(
	options: DiskGuardOptions,
): Promise<void> {
	const minFree = options.minFreeBytes ?? DEFAULT_MIN_FREE_BYTES;
	const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
	const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
	const readSpace = options.readSpace ?? readDiskSpace;
	const sleep =
		options.sleep ??
		((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

	let waited = 0;
	while (true) {
		const space = await readSpace(options.path);
		if (space.freeBytes >= minFree) return;
		if (waited >= maxWaitMs) {
			throw new DiskSpaceExhausted(space.freeBytes, minFree, waited);
		}
		options.onPause?.(space, waited);
		await sleep(pollMs);
		waited += pollMs;
	}
}
