import { join } from "node:path";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import {
	type StreamsBulkBlockRange,
	formatBlockRangeLabel,
	validateStreamsBulkRange,
} from "../../../streams-bulk/range.ts";
import { measureFile, writeJsonFile } from "../../_shared/file.ts";
import {
	type DatasetManifest,
	type DatasetManifestFile,
	createDatasetManifest,
} from "../../_shared/manifest.ts";
import {
	datasetHistoryManifestObjectPath,
	datasetLatestManifestObjectPath,
	datasetParquetObjectPath,
	datasetSchemaObjectPath,
} from "../../_shared/paths.ts";
import {
	createDatasetsS3Client,
	getDatasetsR2ConfigFromEnv,
	objectExists,
	putFileObject,
	putJsonObject,
} from "../../_shared/upload.ts";
import { writeSbtcTokenEventsParquet } from "./file.ts";
import { readCanonicalSbtcTokenEventRows } from "./query.ts";
import {
	SBTC_TOKEN_EVENTS_DATASET,
	SBTC_TOKEN_EVENTS_SCHEMA_VERSION,
	SBTC_TOKEN_EVENTS_VERSION,
	createSbtcTokenEventsSchemaDocument,
} from "./schema.ts";

export type ExportSbtcTokenEventsRangeOptions = {
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
};

export type ExportSbtcTokenEventsRangeResult = {
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

export async function exportSbtcTokenEventsRange(
	options: ExportSbtcTokenEventsRangeOptions,
): Promise<ExportSbtcTokenEventsRangeResult> {
	const range = validateStreamsBulkRange(options.range);
	const partitionBlockRange = formatBlockRangeLabel(range);
	const generatedAt = options.generatedAt ?? new Date().toISOString();

	const parquetObjectPath = datasetParquetObjectPath(
		options.prefix,
		SBTC_TOKEN_EVENTS_DATASET,
		range,
	);
	const schemaObjectPath = datasetSchemaObjectPath(
		options.prefix,
		SBTC_TOKEN_EVENTS_DATASET,
	);
	const latestManifestObjectPath = datasetLatestManifestObjectPath(
		options.prefix,
		SBTC_TOKEN_EVENTS_DATASET,
	);
	const historyManifestObjectPath = datasetHistoryManifestObjectPath(
		options.prefix,
		SBTC_TOKEN_EVENTS_DATASET,
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

	const rows = await readCanonicalSbtcTokenEventRows({
		range,
		partitionBlockRange,
		db: options.db,
	});
	await writeSbtcTokenEventsParquet({
		outputPath: localParquetPath,
		rows,
		metadata: {
			dataset: SBTC_TOKEN_EVENTS_DATASET,
			network: options.network,
			schema_version: String(SBTC_TOKEN_EVENTS_SCHEMA_VERSION),
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
		schema_version: SBTC_TOKEN_EVENTS_SCHEMA_VERSION,
		created_at: generatedAt,
	};
	const manifest = createDatasetManifest({
		dataset: SBTC_TOKEN_EVENTS_DATASET,
		network: options.network,
		version: SBTC_TOKEN_EVENTS_VERSION,
		schemaVersion: SBTC_TOKEN_EVENTS_SCHEMA_VERSION,
		generatedAt,
		producerVersion: options.producerVersion,
		finalityLagBlocks: options.finalityLagBlocks,
		files: [manifestFile],
	});
	const schemaDocument = createSbtcTokenEventsSchemaDocument(options.network);

	await writeJsonFile(localSchemaPath, schemaDocument);
	await writeJsonFile(localHistoryManifestPath, manifest);
	await writeJsonFile(localLatestManifestPath, manifest);

	if (options.upload) {
		const r2Config = getDatasetsR2ConfigFromEnv();
		const client = createDatasetsS3Client(r2Config);
		if (
			!options.force &&
			(await objectExists({
				client,
				bucket: r2Config.bucket,
				key: parquetObjectPath,
			}))
		) {
			throw new Error(
				`refusing to overwrite existing parquet object ${parquetObjectPath}; pass --force for private/staging reruns`,
			);
		}

		await putFileObject({
			client,
			bucket: r2Config.bucket,
			key: parquetObjectPath,
			path: localParquetPath,
			contentType: "application/vnd.apache.parquet",
		});
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
