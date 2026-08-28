/**
 * Resume a torn archive import. Bootstrap refuses a finished instance
 * (index_progress present) and a fresh empty DB starts from partition 0.
 * A crash mid-COPY leaves rows without progress. Every dataset keeps its own
 * high-water mark because the load runs blocks, then transactions, then
 * events: a crash after the blocks pass leaves blocks at the tip and the child
 * datasets empty, and a single blocks-derived mark would call that complete.
 */

export type ArchivePartitionRange = {
	dataset: string;
	from_block: number;
	to_block: number;
};

export const RESUME_DATASETS = ["blocks", "transactions", "events"] as const;
export type ResumeDataset = (typeof RESUME_DATASETS)[number];

/** MAX(height) for blocks, MAX(block_height) for the child datasets; null
 *  when the table holds no rows. */
export type DatasetHighWater = Record<ResumeDataset, number | null>;

export type ResumePlan =
	| { action: "fresh" }
	| { action: "refuse"; reason: string }
	| {
			action: "resume";
			/** First height to delete per dataset, or null when nothing is torn.
			 *  Already cascaded: a torn parent truncates its children from the
			 *  same height, so no child row ever outlives the block it hangs off. */
			truncateFrom: Record<ResumeDataset, number | null>;
			/** Highest sealed partition boundary per dataset. */
			skipThrough: Record<ResumeDataset, number>;
	  };

function isResumeDataset(value: string): value is ResumeDataset {
	return (RESUME_DATASETS as readonly string[]).includes(value);
}

export function planTornImport(input: {
	hasIndexProgress: boolean;
	highWater: DatasetHighWater;
	partitions: ArchivePartitionRange[];
}): ResumePlan {
	if (input.hasIndexProgress) {
		return {
			action: "refuse",
			reason: "This database already holds a completed bootstrap.",
		};
	}
	if (RESUME_DATASETS.every((d) => input.highWater[d] === null)) {
		return { action: "fresh" };
	}

	const truncateFrom: Record<ResumeDataset, number | null> = {
		blocks: null,
		transactions: null,
		events: null,
	};
	const skipThrough: Record<ResumeDataset, number> = {
		blocks: 0,
		transactions: 0,
		events: 0,
	};

	for (const dataset of RESUME_DATASETS) {
		const mark = input.highWater[dataset];
		if (mark === null) continue;
		const ranges = input.partitions
			.filter((p) => p.dataset === dataset)
			.sort((a, b) => a.from_block - b.from_block);
		const sealed = ranges.filter((p) => p.to_block <= mark);
		skipThrough[dataset] =
			sealed.length > 0 ? Math.max(...sealed.map((p) => p.to_block)) : 0;
		const torn = ranges.find((p) => p.from_block <= mark && p.to_block > mark);
		truncateFrom[dataset] = torn ? torn.from_block : null;
	}

	// Cascade down the FK chain: transactions reference blocks, events
	// reference transactions. A truncated parent takes its children with it
	// from the same height, and a child can never count as sealed beyond
	// what its parent has sealed.
	const minDefined = (...values: Array<number | null>) => {
		const defined = values.filter((v): v is number => v !== null);
		return defined.length === 0 ? null : Math.min(...defined);
	};
	truncateFrom.transactions = minDefined(
		truncateFrom.blocks,
		truncateFrom.transactions,
	);
	truncateFrom.events = minDefined(
		truncateFrom.transactions,
		truncateFrom.events,
	);
	// Rows a child holds above its parent's sealed boundary are no longer
	// counted as loaded, so they must go before the reload COPYs them back
	// or the reload trips the primary key.
	const capTo = (dataset: ResumeDataset, parentSealed: number) => {
		if (skipThrough[dataset] <= parentSealed) return;
		skipThrough[dataset] = parentSealed;
		truncateFrom[dataset] = minDefined(truncateFrom[dataset], parentSealed + 1);
	};
	capTo("transactions", skipThrough.blocks);
	capTo("events", skipThrough.transactions);
	truncateFrom.events = minDefined(
		truncateFrom.transactions,
		truncateFrom.events,
	);

	return { action: "resume", truncateFrom, skipThrough };
}

/**
 * A partition counts as loaded only against its own dataset's sealed mark. A
 * dataset the archive names but this planner does not track is never
 * skipped: reloading is a wasted download, skipping is missing history.
 */
export function partitionIsLoaded(
	partition: ArchivePartitionRange,
	skipThrough: Record<ResumeDataset, number>,
): boolean {
	if (!isResumeDataset(partition.dataset)) return false;
	return partition.to_block <= skipThrough[partition.dataset];
}
