import { join } from "node:path";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import {
	type StreamsBulkBlockRange,
	formatBlockRangeLabel,
	validateStreamsBulkRange,
} from "../../streams-bulk/range.ts";
import { measureFile, writeJsonFile } from "./file.ts";
import {
	type DatasetManifest,
	type DatasetManifestFile,
	createDatasetManifest,
} from "./manifest.ts";
import {
	datasetHistoryManifestObjectPath,
	datasetLatestManifestObjectPath,
	datasetLatestManifestRootAliasObjectPath,
	datasetParquetObjectPath,
	datasetSchemaObjectPath,
} from "./paths.ts";
import {
	createDatasetsS3Client,
	getDatasetsR2ConfigFromEnv,
	objectExists,
	putFileObject,
	putJsonObject,
} from "./upload.ts";

export type DatasetRowWithCursor = { cursor: string };

export type DatasetParquetMetadata = {
	dataset: string;
	network: string;
	schema_version: string;
	partition_block_range: string;
	generated_at: string;
	producer_version: string;
};

export type DatasetExporterSpec<Row extends DatasetRowWithCursor> = {
	dataset: string;
	version: string;
	schemaVersion: number;
	readRows: (opts: {
		range: StreamsBulkBlockRange;
		partitionBlockRange: string;
		db?: Kysely<Database>;
	}) => Promise<Row[]>;
	writeParquet: (opts: {
		outputPath: string;
		rows: Row[];
		metadata: DatasetParquetMetadata;
	}) => Promise<void>;
	buildSchemaDocument: (network: string) => unknown;
};

export type ExportDatasetRangeOptions = {
	range: StreamsBulkBlockRange;
	network: string;
	prefix: string;
	outputDir: string;
	finalityLagBlocks: number;
	generatedAt?: string;
	producerVersion: string;
	upload?: boolean;
	force?: boolean;
	db?: Kysely<Database>;
	/**
	 * Refresh manifests only — re-derive rows + manifests, upload only the
	 * manifest + schema JSON. Skip the parquet upload (the existing object
	 * on R2 is byte-identical for a finalized range). Lets the scheduler
	 * keep `latest.json` fresh on no-op ticks where the parquet already
	 * exists, so consumers always see the actual latest finalized range.
	 */
	manifestOnly?: boolean;
};

export type ExportDatasetRangeResult = {
	range: StreamsBulkBlockRange;
	rowCount: number;
	parquetObjectPath: string;
	schemaObjectPath: string;
	latestManifestObjectPath: string;
	historyManifestObjectPath: string;
	localParquetPath: string;
	localSchemaPath: string;
	localLatestManifestPath: string;
	localHistoryManifestPath: string;
	manifest: DatasetManifest;
	uploaded: boolean;
};

export async function exportDatasetRange<Row extends DatasetRowWithCursor>(
	spec: DatasetExporterSpec<Row>,
	options: ExportDatasetRangeOptions,
): Promise<ExportDatasetRangeResult> {
	const range = validateStreamsBulkRange(options.range);
	const partitionBlockRange = formatBlockRangeLabel(range);
	const generatedAt = options.generatedAt ?? new Date().toISOString();

	const parquetObjectPath = datasetParquetObjectPath(
		options.prefix,
		spec.dataset,
		range,
	);
	const schemaObjectPath = datasetSchemaObjectPath(options.prefix, spec.dataset);
	const latestManifestObjectPath = datasetLatestManifestObjectPath(
		options.prefix,
		spec.dataset,
	);
	const historyManifestObjectPath = datasetHistoryManifestObjectPath(
		options.prefix,
		spec.dataset,
		generatedAt,
	);

	const localParquetPath = join(options.outputDir, parquetObjectPath);
	const localSchemaPath = join(options.outputDir, schemaObjectPath);
	const localLatestManifestPath = join(
		options.outputDir,
		latestManifestObjectPath,
	);
	const localHistoryManifestPath = join(
		options.outputDir,
		historyManifestObjectPath,
	);

	const rows = await spec.readRows({
		range,
		partitionBlockRange,
		db: options.db,
	});
	await spec.writeParquet({
		outputPath: localParquetPath,
		rows,
		metadata: {
			dataset: spec.dataset,
			network: options.network,
			schema_version: String(spec.schemaVersion),
			partition_block_range: partitionBlockRange,
			generated_at: generatedAt,
			producer_version: options.producerVersion,
		},
	});
	const fileStats = await measureFile(localParquetPath);
	const manifestFile: DatasetManifestFile = {
		path: parquetObjectPath,
		from_block: range.fromBlock,
		to_block: range.toBlock,
		min_cursor: rows[0]?.cursor ?? null,
		max_cursor: rows.at(-1)?.cursor ?? null,
		row_count: rows.length,
		byte_size: fileStats.byteSize,
		sha256: fileStats.sha256,
		schema_version: spec.schemaVersion,
		created_at: generatedAt,
	};
	const manifest = createDatasetManifest({
		dataset: spec.dataset,
		network: options.network,
		version: spec.version,
		schemaVersion: spec.schemaVersion,
		generatedAt,
		producerVersion: options.producerVersion,
		finalityLagBlocks: options.finalityLagBlocks,
		files: [manifestFile],
	});
	const schemaDocument = spec.buildSchemaDocument(options.network);

	await writeJsonFile(localSchemaPath, schemaDocument);
	await writeJsonFile(localHistoryManifestPath, manifest);
	await writeJsonFile(localLatestManifestPath, manifest);

	if (options.upload) {
		const r2Config = getDatasetsR2ConfigFromEnv();
		const client = createDatasetsS3Client(r2Config);
		const parquetExists = await objectExists({
			client,
			bucket: r2Config.bucket,
			key: parquetObjectPath,
		});
		if (parquetExists && !options.force && !options.manifestOnly) {
			throw new Error(
				`refusing to overwrite existing parquet object ${parquetObjectPath}; pass --force for private/staging reruns`,
			);
		}

		if (!options.manifestOnly) {
			await putFileObject({
				client,
				bucket: r2Config.bucket,
				key: parquetObjectPath,
				path: localParquetPath,
				contentType: "application/vnd.apache.parquet",
			});
		}
		await putJsonObject({
			client,
			bucket: r2Config.bucket,
			key: schemaObjectPath,
			value: schemaDocument,
		});
		await putJsonObject({
			client,
			bucket: r2Config.bucket,
			key: historyManifestObjectPath,
			value: manifest,
		});
		await putJsonObject({
			client,
			bucket: r2Config.bucket,
			key: latestManifestObjectPath,
			value: manifest,
		});
		// Family-root alias — docs say "latest.json per family"; without
		// this, `<root>/<family>/latest.json` 404s and quickstart snippets die.
		await putJsonObject({
			client,
			bucket: r2Config.bucket,
			key: datasetLatestManifestRootAliasObjectPath(
				options.prefix,
				spec.dataset,
			),
			value: manifest,
		});
	}

	return {
		range,
		rowCount: rows.length,
		parquetObjectPath,
		schemaObjectPath,
		latestManifestObjectPath,
		historyManifestObjectPath,
		localParquetPath,
		localSchemaPath,
		localLatestManifestPath,
		localHistoryManifestPath,
		manifest,
		uploaded: options.upload ?? false,
	};
}
