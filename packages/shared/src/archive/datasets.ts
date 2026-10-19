/**
 * The canonical archive's datasets — the one list every exporter, loader,
 * verifier and fetch gate derives from.
 *
 * Order is load order: each dataset's foreign keys point only at datasets
 * earlier in the list, so loading in this order never violates a constraint.
 *
 * Per-dataset code branches with an exhaustive `switch` ending in
 * `assertNeverDataset`, never a trailing default: adding a dataset here must
 * fail to compile everywhere it needs its own schema, SQL or table, instead of
 * silently inheriting another dataset's.
 */
export const ARCHIVE_DATASETS = [
	"blocks",
	"transactions",
	"events",
	"state_writes",
] as const;

/** One archive dataset: blocks, transactions, events or state writes. */
export type ArchiveDataset = (typeof ARCHIVE_DATASETS)[number];

export function isArchiveDataset(value: string): value is ArchiveDataset {
	return (ARCHIVE_DATASETS as readonly string[]).includes(value);
}

/**
 * Datasets a manifest may leave out. The exporter publishes `state_writes`
 * only from an instance that holds it from the start of the exported range,
 * so a manifest without it means "not published", never "empty": consumers
 * must not treat its absence as zero rows, or as rows missing locally.
 * The core datasets are always published; a manifest that lacks one of them
 * is incomplete, and consumers say so.
 */
const OPTIONAL_DATASET: Record<ArchiveDataset, boolean> = {
	blocks: false,
	transactions: false,
	events: false,
	state_writes: true,
};

export function isOptionalDataset(dataset: ArchiveDataset): boolean {
	return OPTIONAL_DATASET[dataset];
}

/**
 * Whether a manifest publishes a dataset: always for a core dataset, and for
 * an optional one only when it names at least one partition or zero-record
 * range of it.
 */
export function manifestPublishes(
	manifest: {
		partitions?: ReadonlyArray<{ dataset: string }>;
		zero_record_ranges?: ReadonlyArray<{ dataset: string }>;
	},
	dataset: ArchiveDataset,
): boolean {
	if (!isOptionalDataset(dataset)) return true;
	return (
		(manifest.partitions ?? []).some((p) => p.dataset === dataset) ||
		(manifest.zero_record_ranges ?? []).some((z) => z.dataset === dataset)
	);
}

/**
 * The column a dataset's rows are placed at a height by. Each dataset is
 * stored in the table of the same name.
 */
export function archiveHeightColumn(
	dataset: ArchiveDataset,
): "height" | "block_height" {
	switch (dataset) {
		case "blocks":
			return "height";
		case "transactions":
		case "events":
		case "state_writes":
			return "block_height";
		default:
			return assertNeverDataset(dataset);
	}
}

export function assertNeverDataset(dataset: never): never {
	throw new Error(`unhandled archive dataset: ${String(dataset)}`);
}
