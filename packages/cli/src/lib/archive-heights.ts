import { assertNeverDataset } from "@secondlayer/shared/archive/datasets";
import type { DigestIndexPartition } from "@secondlayer/shared/archive/per-height-digest";
import {
	PerHeightDigestAccumulator,
	type PerHeightDigestRow,
} from "@secondlayer/shared/archive/per-height-digest";
import {
	type CanonicalDataset,
	streamHeightDigests,
} from "@secondlayer/shared/archive/semantic-digest-builder";
import type { getDb } from "@secondlayer/shared/db";
import {
	type LoadedReference,
	fetchVerifiedPartition,
} from "./archive-reference.ts";
import { readPartitionRows } from "./parquet-rows.ts";

/**
 * Per-height narrowing for `sl verify`. A divergent range says "somewhere in
 * these 50k blocks"; the archive's per-height digest sidecar (`digest_index[]`
 * in the signed manifest) says which heights, and which part of each height.
 *
 * Sidecars are read from the reference root with the plain, unmetered fetch
 * and checked against the manifest's sha256. They never go through the
 * metered fetch gate, even for the official host: verifying stays free.
 */

type Db = ReturnType<typeof getDb>;

export type HeightPart =
	| "block"
	| "transactions"
	| "events"
	| "missing-local"
	| "missing-archive";

export type DivergentHeight = { height: number; parts: HeightPart[] };

/** Datasets the per-height sidecar carries a part for. */
type SidecarDataset = Exclude<CanonicalDataset, "state_writes">;

const PART_FOR_DATASET = {
	blocks: "block",
	transactions: "transactions",
	events: "events",
} as const satisfies Record<SidecarDataset, HeightPart>;

/**
 * Whether the per-height sidecar can narrow a divergent range of this
 * dataset to heights. The sidecar has no `state_writes` rollup column, so a
 * `state_writes` range stays a range: it is still verified, just not
 * narrowed.
 */
export function sidecarNarrows(
	dataset: CanonicalDataset,
): dataset is SidecarDataset {
	switch (dataset) {
		case "blocks":
		case "transactions":
		case "events":
			return true;
		case "state_writes":
			return false;
		default:
			return assertNeverDataset(dataset);
	}
}

/**
 * Rebuild the exporter's sidecar rows from the local database. Feeds the same
 * accumulator from the same ordered row digests the exporter uses, so honest
 * data yields identical rows. Blocks are always streamed (the accumulator
 * refuses a height without a block digest); transactions and events only when
 * asked, since events dominate the cost.
 */
export async function localPerHeightDigests(
	db: Db,
	fromBlock: number,
	toBlock: number,
	datasets: readonly SidecarDataset[] = ["blocks", "transactions", "events"],
): Promise<Map<number, PerHeightDigestRow>> {
	const accumulator = new PerHeightDigestAccumulator();
	for await (const { height, digest } of streamHeightDigests(
		db,
		"blocks",
		fromBlock,
		toBlock,
	)) {
		accumulator.setBlockDigest(height, digest);
	}
	if (datasets.includes("transactions")) {
		for await (const { height, digest } of streamHeightDigests(
			db,
			"transactions",
			fromBlock,
			toBlock,
		)) {
			accumulator.appendTransactionDigest(height, digest);
		}
	}
	if (datasets.includes("events")) {
		for await (const { height, digest } of streamHeightDigests(
			db,
			"events",
			fromBlock,
			toBlock,
		)) {
			accumulator.appendEventDigest(height, digest);
		}
	}
	const rows = new Map<number, PerHeightDigestRow>();
	for (const row of accumulator.drain(fromBlock, toBlock)) {
		rows.set(row.height, row);
	}
	return rows;
}

/** Sidecar partitions whose span overlaps `[fromBlock, toBlock]`. */
export function sidecarsCovering(
	digestIndex: readonly DigestIndexPartition[] | undefined,
	fromBlock: number,
	toBlock: number,
): DigestIndexPartition[] {
	return (digestIndex ?? []).filter(
		(p) => p.from_block <= toBlock && p.to_block >= fromBlock,
	);
}

/** Fetch one sidecar from the reference root and read its rows. */
export async function fetchSidecarRows(
	reference: LoadedReference,
	partition: DigestIndexPartition,
): Promise<PerHeightDigestRow[]> {
	// No gate argument, on purpose: see the module comment.
	const bytes = await fetchVerifiedPartition(reference, partition);
	const rows: PerHeightDigestRow[] = [];
	for await (const raw of readPartitionRows(
		bytes,
		`digests-${partition.from_block}-${partition.to_block}`,
	)) {
		const row = raw as unknown as Record<string, unknown>;
		rows.push({
			height: Number(row.height),
			block_digest: String(row.block_digest),
			transactions_rollup:
				row.transactions_rollup == null
					? null
					: String(row.transactions_rollup),
			events_rollup:
				row.events_rollup == null ? null : String(row.events_rollup),
		});
	}
	return rows;
}

/**
 * Compare local and archive rows height by height, for one dataset's part.
 * `covered` lists the spans the archive sidecars speak for: a local height
 * outside them is unknown to the archive, not evidence of divergence.
 */
export function compareHeights(params: {
	dataset: SidecarDataset;
	fromBlock: number;
	toBlock: number;
	local: ReadonlyMap<number, PerHeightDigestRow>;
	archive: ReadonlyMap<number, PerHeightDigestRow>;
	covered: ReadonlyArray<{ from_block: number; to_block: number }>;
}): DivergentHeight[] {
	const { dataset, fromBlock, toBlock, local, archive, covered } = params;
	const inCoverage = (h: number) =>
		covered.some((c) => h >= c.from_block && h <= c.to_block);
	const heights = new Set<number>();
	for (const h of archive.keys()) heights.add(h);
	for (const h of local.keys()) if (inCoverage(h)) heights.add(h);

	const out: DivergentHeight[] = [];
	for (const height of [...heights].sort((a, b) => a - b)) {
		if (height < fromBlock || height > toBlock) continue;
		const mine = local.get(height);
		const theirs = archive.get(height);
		if (!mine && theirs) {
			out.push({ height, parts: ["missing-local"] });
		} else if (mine && !theirs) {
			out.push({ height, parts: ["missing-archive"] });
		} else if (mine && theirs && !partsMatch(dataset, mine, theirs)) {
			out.push({ height, parts: [PART_FOR_DATASET[dataset]] });
		}
	}
	return out;
}

function partsMatch(
	dataset: SidecarDataset,
	a: PerHeightDigestRow,
	b: PerHeightDigestRow,
): boolean {
	switch (dataset) {
		case "blocks":
			return a.block_digest === b.block_digest;
		case "transactions":
			return a.transactions_rollup === b.transactions_rollup;
		case "events":
			return a.events_rollup === b.events_rollup;
		default:
			return assertNeverDataset(dataset);
	}
}

/**
 * Exact diverging heights for one divergent range, or `null` when no sidecar
 * covers it or the sidecar carries no part for the dataset (`sidecarNarrows`). Fetches and verifies each overlapping sidecar, rebuilds local
 * digests for the range, and compares the part that matches the range's
 * dataset.
 */
export async function divergentHeightsForRange(params: {
	db: Db;
	reference: LoadedReference;
	digestIndex: readonly DigestIndexPartition[] | undefined;
	dataset: CanonicalDataset;
	fromBlock: number;
	toBlock: number;
}): Promise<DivergentHeight[] | null> {
	const { db, reference, dataset, fromBlock, toBlock } = params;
	if (!sidecarNarrows(dataset)) return null;
	const sidecars = sidecarsCovering(params.digestIndex, fromBlock, toBlock);
	if (sidecars.length === 0) return null;

	const archive = new Map<number, PerHeightDigestRow>();
	for (const sidecar of sidecars) {
		for (const row of await fetchSidecarRows(reference, sidecar)) {
			archive.set(row.height, row);
		}
	}
	const local = await localPerHeightDigests(db, fromBlock, toBlock, [dataset]);
	return compareHeights({
		dataset,
		fromBlock,
		toBlock,
		local,
		archive,
		covered: sidecars,
	});
}

/**
 * Collapse divergent ranges (across datasets) into the fewest contiguous
 * spans, so each gets exactly one repair command.
 */
export function mergeRepairRanges(
	ranges: ReadonlyArray<{ from_block: number; to_block: number }>,
): Array<{ from_block: number; to_block: number }> {
	const sorted = [...ranges].sort(
		(a, b) => a.from_block - b.from_block || a.to_block - b.to_block,
	);
	const merged: Array<{ from_block: number; to_block: number }> = [];
	for (const range of sorted) {
		const last = merged[merged.length - 1];
		if (last && range.from_block <= last.to_block + 1) {
			last.to_block = Math.max(last.to_block, range.to_block);
		} else {
			merged.push({ from_block: range.from_block, to_block: range.to_block });
		}
	}
	return merged;
}
