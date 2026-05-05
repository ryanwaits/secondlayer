import {
	type StreamsBulkBlockRange,
	formatBlockRangeLabel,
} from "./range.ts";

export const DEFAULT_STREAMS_BULK_PREFIX = "stacks-streams/mainnet/v0";

export function normalizeObjectPrefix(prefix: string): string {
	const trimmed = prefix.trim().replace(/^\/+|\/+$/g, "");
	if (!trimmed) throw new Error("object prefix must not be empty");
	return trimmed;
}

export function joinObjectPath(prefix: string, path: string): string {
	return `${normalizeObjectPrefix(prefix)}/${path.replace(/^\/+/, "")}`;
}

export function streamsBulkParquetObjectPath(
	prefix: string,
	range: StreamsBulkBlockRange,
): string {
	return joinObjectPath(
		prefix,
		`events/block_height/${formatBlockRangeLabel(range)}/events.parquet`,
	);
}

export function streamsBulkLatestManifestObjectPath(prefix: string): string {
	return joinObjectPath(prefix, "manifest/latest.json");
}

export function streamsBulkHistoryManifestObjectPath(
	prefix: string,
	generatedAt: string,
): string {
	return joinObjectPath(
		prefix,
		`manifest/history/${manifestTimestampSlug(generatedAt)}.json`,
	);
}

export function streamsBulkSchemaObjectPath(prefix: string): string {
	return joinObjectPath(prefix, "schema.json");
}

export function manifestTimestampSlug(generatedAt: string): string {
	const timestamp = new Date(generatedAt);
	if (Number.isNaN(timestamp.getTime())) {
		throw new Error(`invalid generated_at timestamp: ${generatedAt}`);
	}
	return timestamp
		.toISOString()
		.replace(/\.\d{3}Z$/, "Z")
		.replace(/[-:]/g, "");
}
