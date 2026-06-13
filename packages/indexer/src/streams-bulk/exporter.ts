import { join } from "node:path";
import type { Database } from "@secondlayer/shared/db/schema";
import { signStreamsBulkManifest } from "@secondlayer/shared/streams-bulk-manifest";
import type { Kysely } from "kysely";
import { measureFile, writeJsonFile, writeStreamsBulkParquet } from "./file.ts";
import {
	type StreamsBulkManifest,
	type StreamsBulkManifestFile,
	createStreamsBulkManifest,
	mergeStreamsBulkManifestFiles,
} from "./manifest.ts";
import {
	streamsBulkHistoryManifestObjectPath,
	streamsBulkLatestManifestObjectPath,
	streamsBulkParquetObjectPath,
	streamsBulkSchemaObjectPath,
} from "./paths.ts";
import { readCanonicalStreamsBulkRows } from "./query.ts";
import {
	type StreamsBulkBlockRange,
	formatBlockRangeLabel,
	validateStreamsBulkRange,
} from "./range.ts";
import {
	STREAMS_BULK_SCHEMA_VERSION,
	createStreamsBulkSchemaDocument,
} from "./schema.ts";
import {
	createStreamsBulkS3Client,
	getJsonObject,
	getStreamsBulkR2ConfigFromEnv,
	objectExists,
	putFileObject,
	putJsonObject,
} from "./upload.ts";

export type ExportStreamsBulkRangeOptions = {
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

export type ExportStreamsBulkRangeResult = {
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
	manifest: StreamsBulkManifest;
	uploaded: boolean;
};

export async function exportStreamsBulkRange(
	options: ExportStreamsBulkRangeOptions,
): Promise<ExportStreamsBulkRangeResult> {
	const range = validateStreamsBulkRange(options.range);
	const partitionBlockRange = formatBlockRangeLabel(range);
	const generatedAt = options.generatedAt ?? new Date().toISOString();

	const parquetObjectPath = streamsBulkParquetObjectPath(options.prefix, range);
	const schemaObjectPath = streamsBulkSchemaObjectPath(options.prefix);
	const latestManifestObjectPath = streamsBulkLatestManifestObjectPath(
		options.prefix,
	);
	const historyManifestObjectPath = streamsBulkHistoryManifestObjectPath(
		options.prefix,
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

	const rows = await readCanonicalStreamsBulkRows({
		range,
		partitionBlockRange,
		db: options.db,
	});
	await writeStreamsBulkParquet({
		outputPath: localParquetPath,
		rows,
		metadata: {
			dataset: "stacks-streams",
			network: options.network,
			schema_version: String(STREAMS_BULK_SCHEMA_VERSION),
			partition_block_range: partitionBlockRange,
			generated_at: generatedAt,
			producer_version: options.producerVersion,
		},
	});
	const fileStats = await measureFile(localParquetPath);
	const manifestFile = createManifestFile({
		path: parquetObjectPath,
		range,
		rowCount: rows.length,
		byteSize: fileStats.byteSize,
		sha256: fileStats.sha256,
		minCursor: rows[0]?.cursor ?? null,
		maxCursor: rows.at(-1)?.cursor ?? null,
		createdAt: generatedAt,
	});
	// Sign with the platform Streams key so the cold lane carries the same
	// authenticity proof as the live lane. Unsigned (legacy shape) when no key
	// is configured, so export still works before the key is provisioned.
	const signingKey = process.env.STREAMS_SIGNING_PRIVATE_KEY;
	const sign = (m: StreamsBulkManifest): StreamsBulkManifest =>
		signingKey ? signStreamsBulkManifest(m, signingKey) : m;
	const buildManifest = (files: StreamsBulkManifestFile[]) =>
		sign(
			createStreamsBulkManifest({
				network: options.network,
				generatedAt,
				producerVersion: options.producerVersion,
				finalityLagBlocks: options.finalityLagBlocks,
				files,
			}),
		);

	// The per-run history manifest is a single-window audit record; latest.json
	// is the cumulative catalog of every window, so `replay` can backfill the
	// full dump history rather than only the newest window.
	const historyManifest = buildManifest([manifestFile]);

	let r2Config: ReturnType<typeof getStreamsBulkR2ConfigFromEnv> | undefined;
	let client: ReturnType<typeof createStreamsBulkS3Client> | undefined;
	let priorFiles: StreamsBulkManifestFile[] = [];
	if (options.upload) {
		r2Config = getStreamsBulkR2ConfigFromEnv();
		client = createStreamsBulkS3Client(r2Config);
		const priorLatest = await getJsonObject<StreamsBulkManifest>({
			client,
			bucket: r2Config.bucket,
			key: latestManifestObjectPath,
		});
		priorFiles = priorLatest?.files ?? [];
	}
	const latestManifest = buildManifest(
		mergeStreamsBulkManifestFiles(priorFiles, [manifestFile]),
	);
	const schemaDocument = createStreamsBulkSchemaDocument(options.network);

	await writeJsonFile(localSchemaPath, schemaDocument);
	await writeJsonFile(localHistoryManifestPath, historyManifest);
	await writeJsonFile(localLatestManifestPath, latestManifest);

	if (options.upload && r2Config && client) {
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
			value: historyManifest,
		});
		await putJsonObject({
			client,
			bucket: r2Config.bucket,
			key: latestManifestObjectPath,
			value: latestManifest,
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
		manifest: latestManifest,
		uploaded: options.upload ?? false,
	};
}

function createManifestFile(params: {
	path: string;
	range: StreamsBulkBlockRange;
	rowCount: number;
	byteSize: number;
	sha256: string;
	minCursor: string | null;
	maxCursor: string | null;
	createdAt: string;
}): StreamsBulkManifestFile {
	return {
		path: params.path,
		from_block: params.range.fromBlock,
		to_block: params.range.toBlock,
		min_cursor: params.minCursor,
		max_cursor: params.maxCursor,
		row_count: params.rowCount,
		byte_size: params.byteSize,
		sha256: params.sha256,
		schema_version: STREAMS_BULK_SCHEMA_VERSION,
		created_at: params.createdAt,
	};
}
