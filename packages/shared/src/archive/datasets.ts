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
export const ARCHIVE_DATASETS = ["blocks", "transactions", "events"] as const;

export type ArchiveDataset = (typeof ARCHIVE_DATASETS)[number];

export function isArchiveDataset(value: string): value is ArchiveDataset {
	return (ARCHIVE_DATASETS as readonly string[]).includes(value);
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
			return "block_height";
		default:
			return assertNeverDataset(dataset);
	}
}

export function assertNeverDataset(dataset: never): never {
	throw new Error(`unhandled archive dataset: ${String(dataset)}`);
}
