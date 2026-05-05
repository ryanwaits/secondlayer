import { closeDb } from "@secondlayer/shared/db";
import { ParquetReader } from "@dsnp/parquetjs";
import { getStreamsBulkRuntimeConfigFromEnv } from "./config.ts";
import { readJsonFile, sha256Buffer } from "./file.ts";
import type { StreamsBulkManifest } from "./manifest.ts";
import { streamsBulkLatestManifestObjectPath } from "./paths.ts";
import { countCanonicalStreamsBulkRows } from "./query.ts";
import { createStreamsBulkSchemaDocument } from "./schema.ts";
import {
	createStreamsBulkS3Client,
	getObjectBuffer,
	getStreamsBulkR2ConfigFromEnv,
} from "./upload.ts";

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const config = getStreamsBulkRuntimeConfigFromEnv();
	const manifest = args.localManifest
		? await readJsonFile<StreamsBulkManifest>(args.localManifest)
		: await readRemoteManifest(config.prefix);

	const file = manifest.files[0];
	if (!file) throw new Error("manifest has no files");

	const expectedSchema = createStreamsBulkSchemaDocument(config.network);
	if (manifest.schema_version !== expectedSchema.schema_version) {
		throw new Error(
			`schema version mismatch: manifest=${manifest.schema_version} expected=${expectedSchema.schema_version}`,
		);
	}

	const parquetBuffer = args.localParquet
		? Buffer.from(await Bun.file(args.localParquet).arrayBuffer())
		: await readRemoteObject(file.path);
	const actualSha256 = sha256Buffer(parquetBuffer);
	if (actualSha256 !== file.sha256) {
		throw new Error(
			`sha256 mismatch for ${file.path}: ${actualSha256} != ${file.sha256}`,
		);
	}

	const reader = await ParquetReader.openBuffer(parquetBuffer);
	try {
		const parquetRowCount = Number(reader.getRowCount().toString());
		if (parquetRowCount !== file.row_count) {
			throw new Error(
				`parquet row count mismatch: ${parquetRowCount} != ${file.row_count}`,
			);
		}
	} finally {
		await reader.close();
	}

	const dbRowCount = await countCanonicalStreamsBulkRows({
		range: {
			fromBlock: file.from_block,
			toBlock: file.to_block,
		},
	});
	if (dbRowCount !== file.row_count) {
		throw new Error(
			`Postgres row count mismatch: ${dbRowCount} != ${file.row_count}`,
		);
	}

	console.log(
		JSON.stringify(
			{
				ok: true,
				manifest: args.localManifest ?? streamsBulkLatestManifestObjectPath(config.prefix),
				parquet: args.localParquet ?? file.path,
				row_count: file.row_count,
				sha256: actualSha256,
			},
			null,
			2,
		),
	);
}

type SmokeArgs = {
	localManifest?: string;
	localParquet?: string;
};

function parseArgs(args: string[]): SmokeArgs {
	const parsed: SmokeArgs = {};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--local-manifest") {
			const value = args[++index];
			if (!value) throw new Error("--local-manifest requires a value");
			parsed.localManifest = value;
			continue;
		}
		if (arg === "--local-parquet") {
			const value = args[++index];
			if (!value) throw new Error("--local-parquet requires a value");
			parsed.localParquet = value;
			continue;
		}
		throw new Error(`unknown argument: ${arg}`);
	}
	return parsed;
}

async function readRemoteManifest(
	prefix: string,
): Promise<StreamsBulkManifest> {
	const buffer = await readRemoteObject(
		streamsBulkLatestManifestObjectPath(prefix),
	);
	return JSON.parse(buffer.toString("utf8")) as StreamsBulkManifest;
}

async function readRemoteObject(key: string): Promise<Buffer> {
	const r2Config = getStreamsBulkR2ConfigFromEnv();
	return getObjectBuffer({
		client: createStreamsBulkS3Client(r2Config),
		bucket: r2Config.bucket,
		key,
	});
}

main()
	.catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await closeDb();
	});
