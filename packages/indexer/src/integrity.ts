import { getSourceDb, sql } from "@secondlayer/shared/db";
import {
	computeContiguousTip,
	countMissingBlocks,
	findBrokenLinks,
	findGaps,
} from "@secondlayer/shared/db/queries/integrity";
import type { Gap } from "@secondlayer/shared/db/queries/integrity";
import { logger } from "@secondlayer/shared/logger";
import { LocalClient } from "@secondlayer/shared/node/local-client";
import { sendSlackAlert } from "./alerts.ts";
import { ingestNewBlock } from "./ingest.ts";
import type { NewBlockPayload } from "./types/node-events.ts";

// Auto-backfill state (visible to /health/integrity)
export const integrityState = {
	lastCheckAt: null as Date | null,
	gapCount: 0,
	totalMissing: 0,
	gaps: [] as Gap[],
	autoBackfillEnabled: process.env.AUTO_BACKFILL_ENABLED !== "false",
	autoBackfillInProgress: false,
	autoBackfillRemaining: 0,
	// Heights confirmed unfillable from local DB (persists across cycles, unlike
	// autoBackfillRemaining/InProgress which reset to 0/false after every attempt —
	// that reset made a permanently-stuck gap look identical to "caught up").
	autoBackfillUnfillable: [] as number[],
	/** Canonical heights whose parent_hash does not match the block below. */
	brokenLinks: [] as number[],
};

// Track when gaps were first seen (for 5-min cooldown)
const gapFirstSeen = new Map<string, Date>();

function gapKey(gap: Gap): string {
	return `${gap.gapStart}-${gap.gapEnd}`;
}

async function runIntegrityCheck() {
	// Captured before this cycle touches state, so we can detect the
	// unfillable -> resolved / resolved -> unfillable edge below and alert
	// exactly once per transition instead of every 5-min cycle.
	const wasUnfillable = integrityState.autoBackfillUnfillable.length > 0;

	try {
		const db = getSourceDb();
		const gaps = await findGaps(db, 100);
		const missing = await countMissingBlocks(db);
		// Every height can be present while the chain still does not join up —
		// that is exactly how a losing-fork adoption hides. Ask separately.
		const brokenLinks = await findBrokenLinks(db, { limit: 20 });
		integrityState.brokenLinks = brokenLinks.map((l) => l.height);
		if (brokenLinks.length > 0) {
			const first = brokenLinks[0];
			logger.error("Integrity: canonical chain does not link", {
				count: brokenLinks.length,
				heights: integrityState.brokenLinks,
				firstHeight: first?.height,
				storedParent: first?.storedParent,
				expectedParent: first?.expectedParent,
				hint: "a block at this height is off-chain; re-ingest it from the node",
			});
		}

		integrityState.lastCheckAt = new Date();
		integrityState.gapCount = gaps.length;
		integrityState.totalMissing = missing;
		integrityState.gaps = gaps;

		// Always reconcile last_contiguous_block from actual data
		await recomputeContiguous(db);

		if (gaps.length === 0) {
			gapFirstSeen.clear();
			integrityState.autoBackfillUnfillable = [];
			if (wasUnfillable) {
				await sendSlackAlert(
					"✅ Indexer: previously-unfillable gap resolved — fully caught up, 0 gaps remaining",
				);
			}
			logger.debug("Integrity check: no gaps");
			return;
		}

		// Track when gaps were first seen
		const currentKeys = new Set<string>();
		for (const gap of gaps) {
			const key = gapKey(gap);
			currentKeys.add(key);
			if (!gapFirstSeen.has(key)) {
				gapFirstSeen.set(key, new Date());
			}
		}
		// Clean up gaps that no longer exist
		for (const key of gapFirstSeen.keys()) {
			if (!currentKeys.has(key)) {
				gapFirstSeen.delete(key);
			}
		}

		logger.info("Integrity check: gaps detected", {
			gapCount: gaps.length,
			totalMissing: missing,
			ranges: gaps.slice(0, 5).map((g: Gap) => `${g.gapStart}-${g.gapEnd}`),
		});

		// Task 4.2: Auto-backfill if enabled
		if (integrityState.autoBackfillEnabled) {
			await autoBackfill(gaps);
		}

		if (!wasUnfillable && integrityState.autoBackfillUnfillable.length > 0) {
			const heights = integrityState.autoBackfillUnfillable;
			await sendSlackAlert(
				`🚨 Indexer: ${heights.length} block(s) confirmed unfillable from local DB (${heights[0]}-${heights[heights.length - 1]}) — needs manual repair, see packages/indexer/REPAIR-GUIDE.md / bulk-backfill.ts`,
			);
		}
	} catch (err) {
		logger.error("Integrity check failed", { error: err });
	}
}

async function recomputeContiguous(db: ReturnType<typeof getSourceDb>) {
	const network = process.env.STACKS_NETWORK || "mainnet";

	// Find the lowest block we have — supports indexing from arbitrary start height
	const { rows: minRows } = await sql<{ min_height: string }>`
    SELECT COALESCE(MIN(height), 0) AS min_height FROM blocks WHERE canonical = true
  `.execute(db);
	const minHeight = Number(minRows[0]?.min_height ?? 0);
	const fromHeight = minHeight > 0 ? minHeight : 1;

	const tip = await computeContiguousTip(db, fromHeight);

	await db
		.updateTable("index_progress")
		.set({ last_contiguous_block: tip, updated_at: new Date() })
		.where("network", "=", network)
		.execute();

	logger.info("Recomputed last_contiguous_block", { tip });
}

/**
 * Re-canonicalize orphaned blocks the canonical chain actually links to.
 *
 * A reorg sweep marks every block at `>= forkHeight` non-canonical and trusts
 * the normal ingest flow to re-establish them "as new-chain blocks arrive".
 * When the new fork contains blocks we ALREADY stored, they never arrive again
 * — the node has no reason to re-deliver them — so they sit `canonical = false`
 * forever. `last_contiguous_block` stops there, and every subgraph wedges
 * behind it. (2026-07-30: three blocks, five subgraphs, several hours.)
 *
 * The proof needs no RPC and no external provider: if the canonical block at
 * `h + 1` has `parent_hash` equal to the orphaned row's `hash` at `h`, then `h`
 * is on the canonical chain by definition — the chain we already trust points
 * straight at it. Walking downward lets a run of orphans reclaim itself from
 * the first canonical descendant.
 *
 * Returns the heights reclaimed, lowest first.
 */
export async function reclaimLinkedOrphans(
	db: ReturnType<typeof getSourceDb>,
	heights: readonly number[],
): Promise<number[]> {
	const reclaimed: number[] = [];
	// Descending: reclaiming h+1 first is what lets h prove itself next.
	for (const height of [...heights].sort((a, b) => b - a)) {
		const { rows } = await sql<{ reclaimed: number | string | null }>`
			UPDATE blocks AS orphan
				 SET canonical = true
			 FROM blocks AS child
			WHERE orphan.height = ${height}
				AND orphan.canonical = false
				AND child.height = ${height} + 1
				AND child.canonical = true
				AND child.parent_hash = orphan.hash
			RETURNING orphan.height AS reclaimed
		`.execute(db);
		if (rows.length > 0) reclaimed.push(height);
	}
	reclaimed.sort((a, b) => a - b);
	return reclaimed;
}

async function autoBackfill(gaps: Gap[]) {
	if (integrityState.autoBackfillInProgress) {
		logger.debug("Auto-backfill already in progress, skipping");
		return;
	}

	const now = new Date();
	const cooldownMs = 5 * 60 * 1000; // 5 minutes

	// Only fill gaps that have been seen for >5 minutes
	const staleGaps = gaps.filter((gap) => {
		const firstSeen = gapFirstSeen.get(gapKey(gap));
		return firstSeen && now.getTime() - firstSeen.getTime() > cooldownMs;
	});

	if (staleGaps.length === 0) {
		logger.debug("No stale gaps to backfill (all < 5 min old)");
		return;
	}

	const totalBlocks = staleGaps.reduce((sum, g) => sum + g.size, 0);
	integrityState.autoBackfillInProgress = true;
	integrityState.autoBackfillRemaining = totalBlocks;

	logger.info("Auto-backfill starting", {
		gaps: staleGaps.length,
		blocks: totalBlocks,
	});

	const localClient = new LocalClient();
	const db = getSourceDb();

	try {
		// Phase 1: Try local DB for each gap height (reprocessing/replays).
		// Ingest in-process — see tip-follower for why self-POST is wrong.
		const remainingHeights = new Set<number>();
		for (const gap of staleGaps) {
			for (let height = gap.gapStart; height <= gap.gapEnd; height++) {
				const block = await localClient.getBlockForReplay(db, height);
				if (block) {
					try {
						await ingestNewBlock(block as unknown as NewBlockPayload);
						integrityState.autoBackfillRemaining--;
					} catch (err) {
						logger.warn("Auto-backfill: local ingest failed", {
							height,
							error: err,
						});
					}
				} else {
					remainingHeights.add(height);
				}
			}
		}

		if (remainingHeights.size === 0) {
			integrityState.autoBackfillUnfillable = [];
			await recomputeContiguous(getSourceDb());
			logger.info("Auto-backfill complete (all from local)", {
				blocks: totalBlocks,
			});
			return;
		}

		// Phase 1b: before declaring anything unfillable, reclaim orphans the
		// canonical chain links to. These are not missing data — they are rows we
		// already have, mislabelled by a reorg sweep whose replacements never
		// re-arrived because they were the same blocks.
		const reclaimed = await reclaimLinkedOrphans(getSourceDb(), [
			...remainingHeights,
		]);
		if (reclaimed.length > 0) {
			for (const height of reclaimed) remainingHeights.delete(height);
			logger.warn(
				"Auto-backfill: reclaimed orphaned blocks on the canonical chain",
				{
					count: reclaimed.length,
					heights: reclaimed.slice(0, 20),
				},
			);
			if (remainingHeights.size === 0) {
				integrityState.autoBackfillUnfillable = [];
				await recomputeContiguous(getSourceDb());
				logger.info("Auto-backfill complete (reclaimed orphans)", {
					blocks: reclaimed.length,
				});
				return;
			}
		}

		// Phase 2: gaps the own DB can't replay. We deliberately do NOT fall back to
		// Hiro's public API here — the platform runs on its own stacks-node and stays
		// Hiro-free. Historical execution events can't be re-derived from raw node RPC,
		// so surface the unfillable gap loudly for re-sync/ops instead of silently
		// reaching an external provider. (Was: HiroClient.getBlockForIndexer fill.)
		//
		// This state persists past this function's `finally` (unlike
		// autoBackfillInProgress/Remaining) so /health/integrity can report a
		// permanently-stuck gap distinctly from "backfill just hasn't run yet" —
		// otherwise a real, unfixable gap looks identical to idle/healthy.
		const sorted = [...remainingHeights].sort((a, b) => a - b);
		integrityState.autoBackfillUnfillable = sorted;
		logger.error("Auto-backfill: unfillable gap (not in local DB)", {
			count: sorted.length,
			first: sorted[0],
			last: sorted[sorted.length - 1],
			hint: "re-sync from the stacks-node event stream; no external fallback",
		});

		await recomputeContiguous(getSourceDb());
		logger.info("Auto-backfill complete", {
			blocks: totalBlocks,
			fromLocal: totalBlocks - remainingHeights.size,
			unfilled: remainingHeights.size,
		});
	} catch (err) {
		logger.error("Auto-backfill failed", { error: err });
	} finally {
		integrityState.autoBackfillInProgress = false;
		integrityState.autoBackfillRemaining = 0;
	}
}

export function startIntegrityLoop(intervalMs = 300_000): () => void {
	logger.info("Starting integrity loop", {
		intervalMs,
		autoBackfill: integrityState.autoBackfillEnabled,
	});

	// Run immediately on start
	runIntegrityCheck();

	const timer = setInterval(runIntegrityCheck, intervalMs);

	return () => {
		clearInterval(timer);
		logger.info("Integrity loop stopped");
	};
}
