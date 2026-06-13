import {
	STREAMS_BULK_DATASET,
	STREAMS_BULK_SCHEMA_VERSION,
	STREAMS_BULK_VERSION,
} from "./schema.ts";

export type StreamsBulkManifestFile = {
	path: string;
	from_block: number;
	to_block: number;
	min_cursor: string | null;
	max_cursor: string | null;
	row_count: number;
	byte_size: number;
	sha256: string;
	schema_version: number;
	created_at: string;
};

export type StreamsBulkManifest = {
	dataset: typeof STREAMS_BULK_DATASET;
	network: string;
	version: typeof STREAMS_BULK_VERSION;
	schema_version: typeof STREAMS_BULK_SCHEMA_VERSION;
	generated_at: string;
	producer_version: string;
	finality_lag_blocks: number;
	latest_finalized_cursor: string | null;
	coverage: {
		from_block: number;
		to_block: number;
	};
	files: StreamsBulkManifestFile[];
	/** ed25519 signature over the manifest's canonical bytes (manifest JSON minus
	 *  these envelope fields). Absent on legacy unsigned manifests. */
	signature?: string;
	/** Short id of the signing public key, for rotation. */
	key_id?: string;
};

/**
 * Union two file lists into one cumulative catalog, deduped by `path`
 * (incoming wins on conflict — a re-export of a range replaces the old entry).
 * Order is irrelevant; {@link createStreamsBulkManifest} sorts by block range.
 */
export function mergeStreamsBulkManifestFiles(
	existing: StreamsBulkManifestFile[],
	incoming: StreamsBulkManifestFile[],
): StreamsBulkManifestFile[] {
	const byPath = new Map<string, StreamsBulkManifestFile>();
	for (const file of existing) byPath.set(file.path, file);
	for (const file of incoming) byPath.set(file.path, file);
	return [...byPath.values()];
}

export function createStreamsBulkManifest(params: {
	network: string;
	generatedAt: string;
	producerVersion: string;
	finalityLagBlocks: number;
	files: StreamsBulkManifestFile[];
}): StreamsBulkManifest {
	if (params.files.length === 0) {
		throw new Error("manifest must include at least one file");
	}
	const sortedFiles = [...params.files].sort((a, b) => {
		if (a.from_block !== b.from_block) return a.from_block - b.from_block;
		return a.to_block - b.to_block;
	});
	const firstFile = sortedFiles[0];
	const lastFile = sortedFiles.at(-1);
	if (!firstFile || !lastFile) {
		throw new Error("manifest must include at least one file");
	}

	return {
		dataset: STREAMS_BULK_DATASET,
		network: params.network,
		version: STREAMS_BULK_VERSION,
		schema_version: STREAMS_BULK_SCHEMA_VERSION,
		generated_at: params.generatedAt,
		producer_version: params.producerVersion,
		finality_lag_blocks: params.finalityLagBlocks,
		latest_finalized_cursor: lastFile.max_cursor,
		coverage: {
			from_block: firstFile.from_block,
			to_block: lastFile.to_block,
		},
		files: sortedFiles,
	};
}
