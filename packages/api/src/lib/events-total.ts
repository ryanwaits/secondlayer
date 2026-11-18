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
 *
 * The finalized baseline is shared between processes through the one-row
 * `events_total_baseline` table. A new process adopts it and only counts above
 * it; one process per rebaseline period wins a claim on that row and recounts,
 * and the others adopt the result.
 */
export type EventsTotalBounds = {
	/** Highest canonical block height. */
	tip: number;
	/** Highest height past burn finality (immutable). */
	finalized: number;
};

export type SavedBaseline = { through: number; count: number; takenAt: number };

/** Where the finalized baseline is shared between processes. */
export type EventsTotalStore = {
	load(): Promise<SavedBaseline | null>;
	/** Try to become the one process that runs the full recount. True = go. */
	claimRebaseline(): Promise<boolean>;
	/** Publish a full recount and release the claim. */
	save(baseline: SavedBaseline): Promise<void>;
	/** Publish an extension; ignored unless it moves `through` forward. */
	extend(through: number, count: number): Promise<void>;
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
	/** Shared baseline; without one the counter keeps it per process only. */
	store?: EventsTotalStore;
	/** How long a rebaseline claim holds before another process may take over. */
	claimTtlMs?: number;
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

export function postgresEventsTotalStore(
	dbOverride?: Kysely<Database>,
	claimTtlMs = 30 * 60_000,
): EventsTotalStore {
	// Resolved per call so importing this module never opens a pool.
	const db = () => dbOverride ?? getSourceDb();
	return {
		async load() {
			const { rows } = await sql<{
				through: string | number | null;
				count: string | number | null;
				taken_at: Date | null;
			}>`
				SELECT through, count, taken_at FROM events_total_baseline WHERE id
			`.execute(db());
			const row = rows[0];
			if (!row || row.through == null || row.count == null || !row.taken_at) {
				return null;
			}
			return {
				through: Number(row.through),
				count: Number(row.count),
				takenAt: row.taken_at.getTime(),
			};
		},
		async claimRebaseline() {
			const { rows } = await sql<{ id: boolean }>`
				INSERT INTO events_total_baseline (id, claimed_at) VALUES (TRUE, now())
				ON CONFLICT (id) DO UPDATE SET claimed_at = now()
				WHERE events_total_baseline.claimed_at IS NULL
					OR events_total_baseline.claimed_at < now() - make_interval(secs => ${claimTtlMs / 1000})
				RETURNING id
			`.execute(db());
			return rows.length > 0;
		},
		async save(baseline) {
			await sql`
				UPDATE events_total_baseline
				SET through = ${baseline.through},
					count = ${baseline.count},
					taken_at = to_timestamp(${baseline.takenAt} / 1000.0),
					claimed_at = NULL
				WHERE id
			`.execute(db());
		},
		async extend(through, count) {
			await sql`
				UPDATE events_total_baseline
				SET through = ${through}, count = ${count}
				WHERE id AND through IS NOT NULL AND through < ${through}
			`.execute(db());
		},
	};
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
	const store = opts.store;

	let baseline: SavedBaseline | null = null;
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
		if (!baseline && store) baseline = await store.load();
		const stale =
			!baseline ||
			frozen < baseline.through ||
			startedAt - baseline.takenAt >= rebaselineMs;
		if (stale) {
			if (!store) {
				baseline = {
					through: frozen,
					count: await countChunked(0, frozen),
					takenAt: startedAt,
				};
			} else if (await store.claimRebaseline()) {
				// If the count throws the claim stays set and expires after
				// `claimTtlMs`, so a crashed recount blocks others only that long.
				baseline = {
					through: frozen,
					count: await countChunked(0, frozen),
					takenAt: startedAt,
				};
				await store.save(baseline);
			} else {
				// Another process is recounting; adopt what it saved if usable.
				const saved = await store.load();
				if (!saved || saved.through > frozen) return;
				baseline = saved;
			}
		}
		if (baseline && frozen > baseline.through) {
			baseline = {
				...baseline,
				through: frozen,
				count:
					baseline.count + (await countChunked(baseline.through + 1, frozen)),
			};
			await store?.extend(baseline.through, baseline.count);
		}
		if (!baseline) return;
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
export const eventsTotal = createEventsTotalCounter({
	store: postgresEventsTotalStore(),
});
