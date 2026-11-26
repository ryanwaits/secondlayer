import { type Database, getSourceDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { type Kysely, sql } from "kysely";
import {
	type EventsTotalBounds,
	readEventsTotalBounds,
} from "./events-total.ts";

/**
 * Contract state coverage. Every block writes at least its MARF bookkeeping,
 * so a canonical block with zero `state_writes` rows means the node never
 * delivered that block's writes. This scans finalized heights for such blocks
 * and publishes `{ from_height, checked_through, gap_heights, gaps }`.
 *
 *   [from_height ... checked_through] [checked_through+1 .. finalized]
 *    scanned once; stored gaps are     new heights scanned each pass
 *    re-checked so backfills clear     (chunked, saved per chunk)
 *
 * Progress is shared between API processes through the one-row
 * `contract_state_coverage` table; the process that wins its `claimed_at`
 * claim scans, the others serve the stored value.
 */
export type HeightRange = { from: number; to: number };

export type ContractStateCoverage = {
	from_height: number | null;
	checked_through: number | null;
	gap_heights: number;
	gaps: HeightRange[];
};

export type SavedCoverage = {
	fromHeight: number;
	checkedThrough: number;
	gaps: HeightRange[];
	gapHeights: number;
};

export type ContractStateCoverageStore = {
	load(): Promise<SavedCoverage | null>;
	claim(): Promise<boolean>;
	/** Persist progress and refresh the claim. */
	save(state: SavedCoverage): Promise<void>;
	release(): Promise<void>;
};

export type ContractStateCoverageOptions = {
	store: ContractStateCoverageStore;
	readBounds?: () => Promise<EventsTotalBounds | null>;
	readFromHeight?: () => Promise<number | null>;
	findMissing?: (from: number, to: number) => Promise<number[]>;
	now?: () => number;
	refreshMs?: number;
	chunkBlocks?: number;
	maxStoredRanges?: number;
};

export type ContractStateCoverageScanner = {
	read(): ContractStateCoverage | null;
	refresh(): Promise<void>;
};

const PUBLISHED_RANGES = 20;

export function mergeGapHeights(
	existing: HeightRange[],
	heights: number[],
): HeightRange[] {
	const ranges = [
		...existing,
		...heights.map((h) => ({ from: h, to: h })),
	].sort((a, b) => a.from - b.from || a.to - b.to);
	const merged: HeightRange[] = [];
	for (const range of ranges) {
		const last = merged[merged.length - 1];
		if (last && range.from <= last.to + 1) {
			last.to = Math.max(last.to, range.to);
		} else {
			merged.push({ from: range.from, to: range.to });
		}
	}
	return merged;
}

export function dropFilled(
	ranges: HeightRange[],
	stillMissing: number[],
): HeightRange[] {
	const sortedRanges = [...ranges].sort((a, b) => a.from - b.from);
	const sortedMissing = [...stillMissing].sort((a, b) => a - b);
	const kept: number[] = [];
	let r = 0;
	for (const height of sortedMissing) {
		while (r < sortedRanges.length && sortedRanges[r].to < height) r++;
		if (r === sortedRanges.length) break;
		if (height >= sortedRanges[r].from) kept.push(height);
	}
	return mergeGapHeights([], kept);
}

export function gapHeightCount(ranges: HeightRange[]): number {
	return ranges.reduce((n, r) => n + (r.to - r.from + 1), 0);
}

export async function readStateWritesFromHeight(
	db: Kysely<Database> = getSourceDb(),
): Promise<number | null> {
	const { rows } = await sql<{ h: string | null }>`
		SELECT min(block_height)::text AS h FROM state_writes
	`.execute(db);
	const h = rows[0]?.h;
	return h == null ? null : Number(h);
}

export async function findCanonicalBlocksWithoutStateWrites(
	from: number,
	to: number,
	db: Kysely<Database> = getSourceDb(),
): Promise<number[]> {
	const { rows } = await sql<{ h: string }>`
		SELECT b.height::text AS h FROM blocks b
		WHERE b.canonical = true AND b.height >= ${from} AND b.height <= ${to}
			AND NOT EXISTS (SELECT 1 FROM state_writes s WHERE s.block_height = b.height)
		ORDER BY b.height
	`.execute(db);
	return rows.map((row) => Number(row.h));
}

export function postgresContractStateCoverageStore(
	dbOverride?: Kysely<Database>,
	claimTtlMs = 30 * 60_000,
): ContractStateCoverageStore {
	const db = () => dbOverride ?? getSourceDb();
	return {
		async load() {
			const { rows } = await sql<{
				from_height: string | null;
				checked_through: string | null;
				gaps: HeightRange[];
				gap_heights: string;
			}>`
				SELECT from_height, checked_through, gaps, gap_heights
				FROM contract_state_coverage WHERE id
			`.execute(db());
			const row = rows[0];
			if (!row || row.from_height == null || row.checked_through == null) {
				return null;
			}
			return {
				fromHeight: Number(row.from_height),
				checkedThrough: Number(row.checked_through),
				gaps: row.gaps,
				gapHeights: Number(row.gap_heights),
			};
		},
		async claim() {
			const { rows } = await sql<{ id: boolean }>`
				INSERT INTO contract_state_coverage (id, claimed_at) VALUES (TRUE, now())
				ON CONFLICT (id) DO UPDATE SET claimed_at = now()
				WHERE contract_state_coverage.claimed_at IS NULL
					OR contract_state_coverage.claimed_at < now() - make_interval(secs => ${claimTtlMs / 1000})
				RETURNING id
			`.execute(db());
			return rows.length > 0;
		},
		async save(state) {
			await sql`
				UPDATE contract_state_coverage
				SET from_height = ${state.fromHeight},
					checked_through = ${state.checkedThrough},
					gaps = ${JSON.stringify(state.gaps)}::text::jsonb,
					gap_heights = ${state.gapHeights},
					updated_at = now(),
					claimed_at = now()
				WHERE id
			`.execute(db());
		},
		async release() {
			await sql`
				UPDATE contract_state_coverage SET claimed_at = NULL WHERE id
			`.execute(db());
		},
	};
}

function publish(state: SavedCoverage): ContractStateCoverage {
	return {
		from_height: state.fromHeight,
		checked_through: state.checkedThrough,
		gap_heights: state.gapHeights,
		gaps: state.gaps.slice(0, PUBLISHED_RANGES),
	};
}

const NO_STATE_WRITES: ContractStateCoverage = {
	from_height: null,
	checked_through: null,
	gap_heights: 0,
	gaps: [],
};

export function createContractStateCoverage(
	opts: ContractStateCoverageOptions,
): ContractStateCoverageScanner {
	const store = opts.store;
	const readBounds = opts.readBounds ?? readEventsTotalBounds;
	const readFromHeight =
		opts.readFromHeight ?? (() => readStateWritesFromHeight());
	const findMissing = opts.findMissing ?? findCanonicalBlocksWithoutStateWrites;
	const now = opts.now ?? Date.now;
	const refreshMs = opts.refreshMs ?? 60_000;
	const chunkBlocks = opts.chunkBlocks ?? 100_000;
	const maxStoredRanges = opts.maxStoredRanges ?? 500;

	let value: ContractStateCoverage | null = null;
	let refreshedAt = Number.NEGATIVE_INFINITY;
	let inflight: Promise<void> | null = null;

	async function recheck(gaps: HeightRange[]): Promise<HeightRange[]> {
		const stillMissing: number[] = [];
		for (const range of gaps) {
			stillMissing.push(...(await findMissing(range.from, range.to)));
		}
		return dropFilled(gaps, stillMissing);
	}

	async function scan(
		stored: SavedCoverage | null,
		fromHeight: number,
		frozen: number,
	): Promise<void> {
		const lowered = stored !== null && fromHeight < stored.fromHeight;
		const prior: SavedCoverage = stored ?? {
			fromHeight,
			checkedThrough: fromHeight - 1,
			gaps: [],
			gapHeights: 0,
		};
		const truncatedHeights = prior.gapHeights - gapHeightCount(prior.gaps);
		let state: SavedCoverage = {
			...prior,
			fromHeight,
			checkedThrough: lowered ? fromHeight - 1 : prior.checkedThrough,
			gaps: await recheck(prior.gaps),
		};
		state.gapHeights = truncatedHeights + gapHeightCount(state.gaps);

		for (let lo = state.checkedThrough + 1; lo <= frozen; lo += chunkBlocks) {
			const hi = Math.min(frozen, lo + chunkBlocks - 1);
			const found = await findMissing(lo, hi);
			let gaps = mergeGapHeights(state.gaps, found);
			let truncated = state.gapHeights - gapHeightCount(state.gaps);
			if (gaps.length > maxStoredRanges) {
				truncated += gapHeightCount(gaps.slice(maxStoredRanges));
				gaps = gaps.slice(0, maxStoredRanges);
			}
			state = {
				fromHeight,
				checkedThrough: hi,
				gaps,
				gapHeights: truncated + gapHeightCount(gaps),
			};
			if (found.length > 0) {
				logger.warn("contract_state.gap", {
					from: lo,
					to: hi,
					gap_heights: found.length,
				});
			}
			await store.save(state);
			value = publish(state);
		}
		await store.save(state);
		value = publish(state);
	}

	async function run(): Promise<void> {
		refreshedAt = now();
		const bounds = await readBounds();
		if (!bounds) {
			value = null;
			return;
		}
		const fromHeight = await readFromHeight();
		if (fromHeight === null) {
			value = NO_STATE_WRITES;
			return;
		}
		const frozen = Math.min(bounds.finalized, bounds.tip);
		const stored = await store.load();
		if (!(await store.claim())) {
			if (stored) value = publish(stored);
			return;
		}
		try {
			await scan(stored, fromHeight, frozen);
		} finally {
			await store.release();
		}
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
					logger.warn("contract state coverage refresh failed", {
						error: err instanceof Error ? err.message : String(err),
					});
				});
			}
			return value;
		},
		refresh,
	};
}

export const contractStateCoverage = createContractStateCoverage({
	store: postgresContractStateCoverageStore(),
});
