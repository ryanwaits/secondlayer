/**
 * Resume a torn archive import. Bootstrap refuses a finished instance
 * (index_progress present) and a fresh empty DB starts from partition 0.
 * A crash mid-COPY leaves blocks without progress — truncate the torn
 * partition range and skip partitions already sealed.
 */

export type ArchivePartitionRange = {
	dataset: string;
	from_block: number;
	to_block: number;
};

export type ResumePlan =
	| { action: "fresh" }
	| { action: "refuse"; reason: string }
	| {
			action: "resume";
			truncateFrom: number | null;
			skipThrough: number;
	  };

export function planTornImport(input: {
	hasIndexProgress: boolean;
	maxBlockHeight: number | null;
	partitions: ArchivePartitionRange[];
}): ResumePlan {
	if (input.hasIndexProgress) {
		return {
			action: "refuse",
			reason: "This database already holds a completed bootstrap.",
		};
	}
	if (input.maxBlockHeight === null || input.maxBlockHeight <= 0) {
		return { action: "fresh" };
	}

	const blockPartitions = input.partitions
		.filter((p) => p.dataset === "blocks")
		.sort((a, b) => a.from_block - b.from_block);

	const sealed = blockPartitions.filter(
		(p) => p.to_block <= (input.maxBlockHeight ?? 0),
	);
	const skipThrough =
		sealed.length > 0 ? Math.max(...sealed.map((p) => p.to_block)) : 0;
	const torn = blockPartitions.find(
		(p) =>
			p.from_block <= (input.maxBlockHeight ?? 0) &&
			p.to_block > (input.maxBlockHeight ?? 0),
	);

	return {
		action: "resume",
		truncateFrom: torn ? torn.from_block : null,
		skipThrough,
	};
}

export function partitionIsLoaded(
	partition: ArchivePartitionRange,
	skipThrough: number,
): boolean {
	return partition.to_block <= skipThrough;
}
