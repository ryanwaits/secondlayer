#!/usr/bin/env bun
/**
 * Allow browsers to read the public archive.
 *
 * The archive is served from R2 with no CORS headers, so any browser fetch is
 * blocked by the same-origin policy — including a locally-run dashboard, which
 * is the direction the self-hosted product is heading. `curl` and the CLI never
 * noticed because non-browser clients ignore CORS entirely.
 *
 * Read-only and public by nature: these objects are already world-readable over
 * HTTPS, so allowing any origin to GET them grants nothing new. Writes are not
 * exposed — they go through credentialed S3 API calls, not the public URL.
 *
 * `ExposeHeaders` matters more than it looks: without it a browser can read the
 * body but not `Content-Range` or `ETag`, which breaks resumable and ranged
 * reads of large partitions from JS.
 *
 * Usage:
 *   bun run packages/indexer/src/archive/configure-bucket-cors.ts          # show
 *   bun run packages/indexer/src/archive/configure-bucket-cors.ts --apply
 */
import { GetBucketCorsCommand, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import {
	createStreamsBulkS3Client,
	getStreamsBulkR2ConfigFromEnv,
} from "../streams-bulk/upload.ts";

const CORS_RULES = [
	{
		AllowedOrigins: ["*"],
		// Read verbs only. A public archive has no browser-initiated writes.
		AllowedMethods: ["GET", "HEAD"],
		AllowedHeaders: ["Range", "If-None-Match", "If-Modified-Since"],
		// Without these a browser cannot see the headers that make ranged and
		// cache-aware reads work.
		ExposeHeaders: [
			"Content-Length",
			"Content-Range",
			"Content-Type",
			"ETag",
			"Cache-Control",
			"Last-Modified",
			"Accept-Ranges",
		],
		MaxAgeSeconds: 3600,
	},
];

async function main(): Promise<void> {
	const apply = process.argv.includes("--apply");
	const config = getStreamsBulkR2ConfigFromEnv();
	const client = createStreamsBulkS3Client(config);

	let current: unknown = null;
	try {
		const existing = await client.send(
			new GetBucketCorsCommand({ Bucket: config.bucket }),
		);
		current = existing.CORSRules ?? null;
	} catch {
		current = null;
	}
	console.log("current:", JSON.stringify(current, null, 2));
	console.log("desired:", JSON.stringify(CORS_RULES, null, 2));

	if (!apply) {
		console.error("\n(dry-run — pass --apply to set)");
		return;
	}

	await client.send(
		new PutBucketCorsCommand({
			Bucket: config.bucket,
			CORSConfiguration: { CORSRules: CORS_RULES },
		}),
	);
	console.error(`\nApplied CORS to ${config.bucket}`);
}

if (import.meta.main) {
	main().catch((err) => {
		console.error(
			"configure-bucket-cors failed:",
			err instanceof Error ? err.message : err,
		);
		process.exit(1);
	});
}
