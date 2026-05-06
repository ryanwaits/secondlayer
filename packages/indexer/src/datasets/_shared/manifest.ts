export type DatasetManifestFile = {
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

export type DatasetManifest = {
	dataset: string;
	network: string;
	version: string;
	schema_version: number;
	generated_at: string;
	producer_version: string;
	finality_lag_blocks: number;
	latest_finalized_cursor: string | null;
	coverage: {
		from_block: number;
		to_block: number;
	};
	files: DatasetManifestFile[];
};

export function createDatasetManifest(params: {
	dataset: string;
	network: string;
	version: string;
	schemaVersion: number;
	generatedAt: string;
	producerVersion: string;
	finalityLagBlocks: number;
	files: DatasetManifestFile[];
}): DatasetManifest {
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
		dataset: params.dataset,
		network: params.network,
		version: params.version,
		schema_version: params.schemaVersion,
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
