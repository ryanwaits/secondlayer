import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { signStreamsBulkManifest } from "@secondlayer/shared/streams-bulk-manifest";
import { getStreamsBulkRuntimeConfigFromEnv } from "./config.ts";
import {
	joinObjectPath,
	streamsBulkLatestManifestObjectPath,
} from "./paths.ts";
import {
	createStreamsBulkS3Client,
	getObjectBuffer,
	getStreamsBulkR2ConfigFromEnv,
	putJsonObject,
} from "./upload.ts";

/**
 * One-shot backfill: sign every existing Streams bulk manifest in R2 (latest +
 * history) that predates manifest signing. Run this BEFORE flipping the SDK's
 * manifest-signature verification on, so already-published manifests verify.
 *
 * Usage: STREAMS_SIGNING_PRIVATE_KEY=… STREAMS_BULK_R2_*=… \
 *          bun run packages/indexer/src/streams-bulk/backfill-manifest-signatures.ts [--dry-run] [--force]
 *
 *   --dry-run  list what would be signed, write nothing
 *   --force    re-sign manifests that already carry a signature
 */
export async function backfillStreamsBulkManifestSignatures(opts: {
	dryRun?: boolean;
	force?: boolean;
}): Promise<{ signed: string[]; skipped: string[] }> {
	const signingKey = process.env.STREAMS_SIGNING_PRIVATE_KEY;
	if (!signingKey) {
		throw new Error("STREAMS_SIGNING_PRIVATE_KEY is required to backfill");
	}
	const { prefix } = getStreamsBulkRuntimeConfigFromEnv();
	const r2 = getStreamsBulkR2ConfigFromEnv();
	const client = createStreamsBulkS3Client(r2);

	const historyPrefix = joinObjectPath(prefix, "manifest/history/");
	const keys = [streamsBulkLatestManifestObjectPath(prefix)];
	let continuationToken: string | undefined;
	do {
		const page = await client.send(
			new ListObjectsV2Command({
				Bucket: r2.bucket,
				Prefix: historyPrefix,
				ContinuationToken: continuationToken,
			}),
		);
		for (const obj of page.Contents ?? []) {
			if (obj.Key?.endsWith(".json")) keys.push(obj.Key);
		}
		continuationToken = page.IsTruncated
			? page.NextContinuationToken
			: undefined;
	} while (continuationToken);

	const signed: string[] = [];
	const skipped: string[] = [];
	for (const key of keys) {
		let manifest: Record<string, unknown> & { signature?: string };
		try {
			const buf = await getObjectBuffer({ client, bucket: r2.bucket, key });
			manifest = JSON.parse(buf.toString("utf8"));
		} catch {
			// latest.json may not exist yet on a fresh prefix; history keys came from
			// a live listing so they do — a parse/fetch failure there is worth seeing.
			skipped.push(`${key} (missing/unreadable)`);
			continue;
		}
		if (manifest.signature && !opts.force) {
			skipped.push(`${key} (already signed)`);
			continue;
		}
		if (opts.dryRun) {
			signed.push(`${key} (dry-run)`);
			continue;
		}
		const resigned = signStreamsBulkManifest(manifest, signingKey);
		await putJsonObject({ client, bucket: r2.bucket, key, value: resigned });
		signed.push(key);
	}

	return { signed, skipped };
}

if (import.meta.main) {
	const args = new Set(process.argv.slice(2));
	backfillStreamsBulkManifestSignatures({
		dryRun: args.has("--dry-run"),
		force: args.has("--force"),
	})
		.then(({ signed, skipped }) => {
			console.log(`signed ${signed.length}:`);
			for (const k of signed) console.log(`  + ${k}`);
			if (skipped.length > 0) {
				console.log(`skipped ${skipped.length}:`);
				for (const k of skipped) console.log(`  - ${k}`);
			}
		})
		.catch((err) => {
			console.error(err);
			process.exit(1);
		});
}
