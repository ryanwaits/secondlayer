import { closeDb } from "@secondlayer/shared/db";
import {
	getStreamsBulkRuntimeConfigFromEnv,
	readIndexerProducerVersion,
} from "./config.ts";
import { exportStreamsBulkRange } from "./exporter.ts";
import {
	latestCompleteFinalizedRange,
	validateStreamsBulkRange,
	type StreamsBulkBlockRange,
} from "./range.ts";
import { getLatestCanonicalBlockHeight } from "./query.ts";

type CliOptions = {
	fromBlock?: number;
	toBlock?: number;
	latestFinalized: boolean;
	upload: boolean;
	force: boolean;
	outputDir?: string;
	help: boolean;
};

async function main() {
	const cli = parseArgs(process.argv.slice(2));
	if (cli.help) {
		printHelp();
		return;
	}

	const config = getStreamsBulkRuntimeConfigFromEnv({
		outputDir: cli.outputDir,
	});
	const range = await resolveRange(
		cli,
		config.rangeSizeBlocks,
		config.finalityLagBlocks,
	);
	const result = await exportStreamsBulkRange({
		range,
		network: config.network,
		prefix: config.prefix,
		outputDir: config.outputDir,
		finalityLagBlocks: config.finalityLagBlocks,
		producerVersion: await readIndexerProducerVersion(),
		upload: cli.upload,
		force: cli.force,
	});

	console.log(
		JSON.stringify(
			{
				range: result.range,
				row_count: result.rowCount,
				parquet_object_path: result.parquetObjectPath,
				latest_manifest_object_path: result.latestManifestObjectPath,
				schema_object_path: result.schemaObjectPath,
				local_parquet_path: result.localParquetPath,
				local_manifest_path: result.localLatestManifestPath,
				uploaded: result.uploaded,
			},
			null,
			2,
		),
	);
}

async function resolveRange(
	cli: CliOptions,
	rangeSizeBlocks: number,
	finalityLagBlocks: number,
): Promise<StreamsBulkBlockRange> {
	if (cli.latestFinalized) {
		if (cli.fromBlock !== undefined || cli.toBlock !== undefined) {
			throw new Error(
				"--latest-finalized cannot be combined with --from-block or --to-block",
			);
		}
		const latestHeight = await getLatestCanonicalBlockHeight();
		if (latestHeight === null) {
			throw new Error("no canonical blocks available");
		}
		const range = latestCompleteFinalizedRange({
			tipBlockHeight: latestHeight,
			rangeSizeBlocks,
			finalityLagBlocks,
		});
		if (!range) {
			throw new Error(
				`no complete finalized ${rangeSizeBlocks}-block range is available`,
			);
		}
		return range;
	}

	if (cli.fromBlock === undefined || cli.toBlock === undefined) {
		throw new Error(
			"pass --latest-finalized or both --from-block and --to-block",
		);
	}

	return validateStreamsBulkRange({
		fromBlock: cli.fromBlock,
		toBlock: cli.toBlock,
	});
}

function parseArgs(args: string[]): CliOptions {
	const options: CliOptions = {
		latestFinalized: false,
		upload: false,
		force: false,
		help: false,
	};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--help" || arg === "-h") {
			options.help = true;
			continue;
		}
		if (arg === "--latest-finalized") {
			options.latestFinalized = true;
			continue;
		}
		if (arg === "--upload") {
			options.upload = true;
			continue;
		}
		if (arg === "--force") {
			options.force = true;
			continue;
		}
		if (arg === "--from-block") {
			options.fromBlock = parseBlockArg(arg, args[++index]);
			continue;
		}
		if (arg === "--to-block") {
			options.toBlock = parseBlockArg(arg, args[++index]);
			continue;
		}
		if (arg === "--output-dir") {
			const value = args[++index];
			if (!value) throw new Error("--output-dir requires a value");
			options.outputDir = value;
			continue;
		}
		throw new Error(`unknown argument: ${arg}`);
	}

	return options;
}

function parseBlockArg(flag: string, value: string | undefined): number {
	if (!value) throw new Error(`${flag} requires a value`);
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < 0) {
		throw new Error(`${flag} must be a non-negative integer`);
	}
	return parsed;
}

function printHelp() {
	console.log(`Usage:
  bun run packages/indexer/src/streams-bulk/export.ts --latest-finalized [--upload] [--force]
  bun run packages/indexer/src/streams-bulk/export.ts --from-block 180000 --to-block 189999 [--upload] [--force]

Options:
  --latest-finalized       Export the latest complete range behind finality lag.
  --from-block <height>    Inclusive range start.
  --to-block <height>      Inclusive range end.
  --output-dir <path>      Local output root. Default: tmp/streams-bulk.
  --upload                 Upload parquet, schema, and manifests to R2.
  --force                  Allow private/staging overwrite of an existing parquet object.
`);
}

main()
	.catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await closeDb();
	});
