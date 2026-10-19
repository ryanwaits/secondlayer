import {
	ARCHIVE_DATASETS,
	type ArchiveDataset,
} from "@secondlayer/shared/archive/datasets";

/**
 * Resume a torn archive import. Bootstrap refuses a finished instance
 * (index_progress present) and a fresh empty DB starts from partition 0.
 * A crash mid-COPY leaves rows without progress. Every dataset keeps its own
 * high-water mark because the load runs dataset by dataset (blocks,
 * transactions, events, state_writes): a crash after the blocks pass leaves
 * blocks at the tip and the child datasets empty, and a single blocks-derived
 * mark would call that complete.
 */

export type ArchivePartitionRange = {
	dataset: string;
	from_block: number;
	to_block: number;
};

export const RESUME_DATASETS = ARCHIVE_DATASETS;
export type ResumeDataset = ArchiveDataset;

/** The dataset each child's foreign key points at. A truncated parent takes
 *  its children with it; a child never counts as sealed past its parent. */
const FK_PARENT: Record<Exclude<ResumeDataset, "blocks">, ResumeDataset> = {
	transactions: "blocks",
	events: "transactions",
	state_writes: "blocks",
};

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

	const truncateFrom = Object.fromEntries(
		RESUME_DATASETS.map((d) => [d, null]),
	) as Record<ResumeDataset, number | null>;
	const skipThrough = Object.fromEntries(
		RESUME_DATASETS.map((d) => [d, 0]),
	) as Record<ResumeDataset, number>;

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

	// Cascade down the FK chain (`FK_PARENT`, walked in load order so a
	// parent is settled before its children). A truncated parent takes its
	// children with it from the same height, and a child can never count as
	// sealed beyond what its parent has sealed.
	const minDefined = (...values: Array<number | null>) => {
		const defined = values.filter((v): v is number => v !== null);
		return defined.length === 0 ? null : Math.min(...defined);
	};
	const children = RESUME_DATASETS.filter(
		(d): d is Exclude<ResumeDataset, "blocks"> => d !== "blocks",
	);
	for (const dataset of children) {
		truncateFrom[dataset] = minDefined(
			truncateFrom[FK_PARENT[dataset]],
			truncateFrom[dataset],
		);
	}
	// Rows a child holds above its parent's sealed boundary are no longer
	// counted as loaded, so they must go before the reload COPYs them back
	// or the reload trips the primary key.
	for (const dataset of children) {
		const parent = FK_PARENT[dataset];
		if (skipThrough[dataset] > skipThrough[parent]) {
			skipThrough[dataset] = skipThrough[parent];
			truncateFrom[dataset] = minDefined(
				truncateFrom[dataset],
				skipThrough[parent] + 1,
			);
		}
		truncateFrom[dataset] = minDefined(
			truncateFrom[parent],
			truncateFrom[dataset],
		);
	}

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
