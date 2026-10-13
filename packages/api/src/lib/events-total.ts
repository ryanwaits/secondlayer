import { type Database, getSourceDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { type Kysely, sql } from "kysely";
import { StreamsTipUnavailableError, getStreamsTip } from "../streams/tip.ts";

/**
 * Total chain events stored — the same set the signed archive publishes as its
 * `events` dataset: rows of `events` whose height is a CANONICAL block
 * (`export-snapshot.ts` / `range-digest.ts` join `blocks` on `canonical = true`).
 *
 * `/public/status` is polled by every open marketing tab, and `events` is
 * hundreds of millions of rows with a uuid PK (no dense id to read a max of),
 * so the request path never counts. It reads an in-memory value that a
 * single-flight refresh keeps current:
 *
 *   [0 ............ finalized] [finalized+1 .. tip]
 *    baseline: counted once,     tail: recounted each refresh
 *    then extended as finality   (≤ ~6 BTC blocks of Stacks blocks,
 *    advances (new rows only)     small index range on block_height)
 *
 * Rows at or below the burn-finality boundary can't reorg, so the baseline is
 * only ever extended. It is fully recounted every `rebaselineMs` anyway, so an
 * operator repair/dedupe below finality is picked up without a restart.
 */
export type EventsTotalBounds = {
	/** Highest canonical block height. */
	tip: number;
	/** Highest height past burn finality (immutable). */
	finalized: number;
};

export type EventsTotalOptions = {
	/** Null when no canonical block exists yet (empty install → total 0). */
	readBounds?: () => Promise<EventsTotalBounds | null>;
	/** Canonical events with `from <= block_height <= to`. */
	countRange?: (from: number, to: number) => Promise<number>;
	now?: () => number;
	refreshMs?: number;
	rebaselineMs?: number;
	/** Heights per baseline query, so no single statement scans all history. */
	chunkBlocks?: number;
};

export type EventsTotalCounter = {
	/** Cached total, or null until the first count lands. Never blocks; kicks a
	 *  background refresh when the value is older than `refreshMs`. */
	read(): number | null;
	/** Run (or join) a refresh. Exposed for tests and warm-up. */
	refresh(): Promise<void>;
};

export async function readEventsTotalBounds(): Promise<EventsTotalBounds | null> {
	try {
		const tip = await getStreamsTip();
		return { tip: tip.block_height, finalized: tip.finalized_height };
	} catch (err) {
		if (err instanceof StreamsTipUnavailableError) return null;
		throw err;
	}
}

export async function countCanonicalEvents(
	from: number,
	to: number,
	db: Kysely<Database> = getSourceDb(),
): Promise<number> {
	const { rows } = await sql<{ n: string }>`
		SELECT count(*)::text AS n
		FROM events AS e
		JOIN blocks AS b ON b.height = e.block_height AND b.canonical = true
		WHERE e.block_height >= ${from} AND e.block_height <= ${to}
	`.execute(db);
	return Number(rows[0]?.n ?? 0);
}

export function createEventsTotalCounter(
	opts: EventsTotalOptions = {},
): EventsTotalCounter {
	const readBounds = opts.readBounds ?? readEventsTotalBounds;
	const countRange = opts.countRange ?? countCanonicalEvents;
	const now = opts.now ?? Date.now;
	const refreshMs = opts.refreshMs ?? 10_000;
	const rebaselineMs = opts.rebaselineMs ?? 6 * 60 * 60 * 1000;
	const chunkBlocks = opts.chunkBlocks ?? 250_000;

	let baseline: { through: number; count: number; takenAt: number } | null =
		null;
	let value: number | null = null;
	let refreshedAt = Number.NEGATIVE_INFINITY;
	let inflight: Promise<void> | null = null;

	async function countChunked(from: number, to: number): Promise<number> {
		let total = 0;
		for (let lo = from; lo <= to; lo += chunkBlocks) {
			total += await countRange(lo, Math.min(to, lo + chunkBlocks - 1));
		}
		return total;
	}

	async function run(): Promise<void> {
		const startedAt = now();
		// Stamped up front so a failing refresh also waits `refreshMs` before
		// the next attempt instead of retrying on every request.
		refreshedAt = startedAt;
		const bounds = await readBounds();
		if (!bounds) {
			baseline = null;
			value = 0;
			return;
		}
		const frozen = Math.min(bounds.finalized, bounds.tip);
		if (
			!baseline ||
			frozen < baseline.through ||
			startedAt - baseline.takenAt >= rebaselineMs
		) {
			baseline = {
				through: frozen,
				count: await countChunked(0, frozen),
				takenAt: startedAt,
			};
		} else if (frozen > baseline.through) {
			baseline = {
				...baseline,
				through: frozen,
				count:
					baseline.count + (await countChunked(baseline.through + 1, frozen)),
			};
		}
		const tail =
			bounds.tip > baseline.through
				? await countRange(baseline.through + 1, bounds.tip)
				: 0;
		value = baseline.count + tail;
	}

	function refresh(): Promise<void> {
		if (!inflight) {
			inflight = run().finally(() => {
				inflight = null;
			});
		}
		return inflight;
	}

	return {
		read() {
			if (!inflight && now() - refreshedAt >= refreshMs) {
				refresh().catch((err) => {
					// Keep serving the last good value; retry on the next read.
					logger.warn("events total refresh failed", {
						error: err instanceof Error ? err.message : String(err),
					});
				});
			}
			return value;
		},
		refresh,
	};
}

/** Process-wide counter behind `/public/status` `index.events_total`. */
export const eventsTotal = createEventsTotalCounter();
