import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { logger } from "@secondlayer/shared/logger";
import { signStreamsBulkManifest } from "@secondlayer/shared/streams-bulk-manifest";
import {
	type StreamsBulkManifest,
	type StreamsBulkManifestFile,
	createStreamsBulkManifest,
	mergeStreamsBulkManifestFiles,
} from "./manifest.ts";
import {
	DEFAULT_STREAMS_BULK_PREFIX,
	normalizeObjectPrefix,
	streamsBulkLatestManifestObjectPath,
} from "./paths.ts";
import {
	createStreamsBulkS3Client,
	getJsonObject,
	getStreamsBulkR2ConfigFromEnv,
	putJsonObject,
} from "./upload.ts";

/**
 * Rebuild `manifest/latest.json` as the cumulative catalog of every window,
 * by unioning the files from all per-run history manifests. A one-time repair
 * for prefixes published before the exporter wrote a cumulative latest.json
 * (which only ever exposed the newest window, so `replay` could not backfill
 * older history). Going forward the exporter keeps latest.json cumulative.
 */
export async function rebuildStreamsBulkLatestManifest(opts: {
	prefix?: string;
	dryRun?: boolean;
}): Promise<{
	fileCount: number;
	coverage: { from_block: number; to_block: number } | null;
	wrote: boolean;
}> {
	const prefix = normalizeObjectPrefix(
		opts.prefix ?? DEFAULT_STREAMS_BULK_PREFIX,
	);
	const r2 = getStreamsBulkR2ConfigFromEnv();
	const client = createStreamsBulkS3Client(r2);

	// Collect every history manifest key.
	const historyPrefix = `${prefix}/manifest/history/`;
	const keys: string[] = [];
	let token: string | undefined;
	do {
		const page = await client.send(
			new ListObjectsV2Command({
				Bucket: r2.bucket,
				Prefix: historyPrefix,
				ContinuationToken: token,
			}),
		);
		for (const obj of page.Contents ?? []) {
			if (obj.Key?.endsWith(".json")) keys.push(obj.Key);
		}
		token = page.IsTruncated ? page.NextContinuationToken : undefined;
	} while (token);

	// Union all files across every history manifest, deduped by path.
	let files: StreamsBulkManifestFile[] = [];
	let newest: StreamsBulkManifest | null = null;
	for (const key of keys) {
		const manifest = await getJsonObject<StreamsBulkManifest>({
			client,
			bucket: r2.bucket,
			key,
		});
		if (!manifest?.files?.length) continue;
		files = mergeStreamsBulkManifestFiles(files, manifest.files);
		if (!newest || manifest.generated_at > newest.generated_at) {
			newest = manifest;
		}
	}

	if (files.length === 0 || !newest) {
		logger.warn("rebuild-latest-manifest: no history manifests found", {
			historyPrefix,
		});
		return { fileCount: 0, coverage: null, wrote: false };
	}

	// Carry the producer metadata from the newest history manifest; coverage and
	// latest_finalized_cursor are recomputed from the unioned file set.
	const rebuilt = createStreamsBulkManifest({
		network: newest.network,
		generatedAt: newest.generated_at,
		producerVersion: newest.producer_version,
		finalityLagBlocks: newest.finality_lag_blocks,
		files,
	});

	const signingKey = process.env.STREAMS_SIGNING_PRIVATE_KEY;
	const manifest = signingKey
		? signStreamsBulkManifest(rebuilt, signingKey)
		: rebuilt;

	logger.info("rebuild-latest-manifest: assembled cumulative manifest", {
		historyManifests: keys.length,
		files: manifest.files.length,
		coverage: manifest.coverage,
		signed: Boolean(signingKey),
		dryRun: Boolean(opts.dryRun),
	});

	if (!opts.dryRun) {
		await putJsonObject({
			client,
			bucket: r2.bucket,
			key: streamsBulkLatestManifestObjectPath(prefix),
			value: manifest,
		});
	}

	return {
		fileCount: manifest.files.length,
		coverage: manifest.coverage,
		wrote: !opts.dryRun,
	};
}

if (import.meta.main) {
	const args = new Set(process.argv.slice(2));
	rebuildStreamsBulkLatestManifest({ dryRun: args.has("--dry-run") })
		.then((result) => {
			console.log(JSON.stringify(result, null, 2));
			process.exit(0);
		})
		.catch((err) => {
			console.error(err);
			process.exit(1);
		});
}
