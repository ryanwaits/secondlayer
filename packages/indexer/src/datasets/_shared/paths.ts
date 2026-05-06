import {
	type StreamsBulkBlockRange,
	formatBlockRangeLabel,
} from "../../streams-bulk/range.ts";
import {
	joinObjectPath,
	manifestTimestampSlug,
} from "../../streams-bulk/paths.ts";

export {
	joinObjectPath,
	manifestTimestampSlug,
	normalizeObjectPrefix,
} from "../../streams-bulk/paths.ts";

export const DEFAULT_DATASETS_PREFIX = "stacks-datasets/mainnet/v0";

export function datasetPrefix(prefix: string, dataset: string): string {
	return joinObjectPath(prefix, dataset);
}

export function datasetParquetObjectPath(
	prefix: string,
	dataset: string,
	range: StreamsBulkBlockRange,
): string {
	return joinObjectPath(
		datasetPrefix(prefix, dataset),
		`data/block_height/${formatBlockRangeLabel(range)}/data.parquet`,
	);
}

export function datasetLatestManifestObjectPath(
	prefix: string,
	dataset: string,
): string {
	return joinObjectPath(
		datasetPrefix(prefix, dataset),
		"manifest/latest.json",
	);
}

export function datasetHistoryManifestObjectPath(
	prefix: string,
	dataset: string,
	generatedAt: string,
): string {
	return joinObjectPath(
		datasetPrefix(prefix, dataset),
		`manifest/history/${manifestTimestampSlug(generatedAt)}.json`,
	);
}

export function datasetSchemaObjectPath(
	prefix: string,
	dataset: string,
): string {
	return joinObjectPath(datasetPrefix(prefix, dataset), "schema.json");
}
