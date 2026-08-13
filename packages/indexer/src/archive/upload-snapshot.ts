import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { HeadObjectCommand, NotFound, type S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createProgressReporter } from "@secondlayer/shared/archive/progress";
import { readJsonFile, sha256File } from "../streams-bulk/file.ts";
import {
	createStreamsBulkS3Client,
	getStreamsBulkR2ConfigFromEnv,
	putJsonObject,
} from "../streams-bulk/upload.ts";
import {
	CANONICAL_ARCHIVE_DATASET,
	CANONICAL_EXPORT_SCHEMA_VERSION,
	type CanonicalSnapshotManifest,
	manifestDigest,
} from "./export-snapshot.ts";

/**
 * Upload a locally exported v1 canonical snapshot to R2 staging.
 *
 * Ordering is the safety mechanism: data partitions first, the snapshot
 * manifest LAST — so the presence of `snapshots/<digest>.json` in the bucket
 * proves every object it references is already there. `latest.json` is never
 * written here; promotion is a separate step with its own validation.
 *
 * Everything is immutable and digest-addressed, which makes the upload
 * resumable for free: an object that already exists at the right size is
 * skipped, so a killed upload continues from the first missing partition.
 * Partitions stream as multipart uploads — nothing buffers a whole file.
 *
 * The local verification gate re-hashes every partition against the manifest
 * before any byte leaves the machine. A corrupted local file can never become
 * an archive object with a lying name.
 */

export const CANONICAL_ARCHIVE_PREFIX = "secondlayer/mainnet/canonical/v1";

const PARQUET_CONTENT_TYPE = "application/vnd.apache.parquet";
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
/** 64 MiB parts: a 1–2 GB partition uploads in ~20–30 parts. */
const MULTIPART_PART_SIZE = 64 * 1024 * 1024;

export type VerifyFailure = {
	path: string;
	reason: "missing" | "size-mismatch" | "digest-mismatch";
	expected: string;
	actual: string;
};

/**
 * Re-hash every partition in the manifest against the local export directory.
 * Returns the failures; an empty array means the local tree is exactly what
 * the manifest signed.
 */
export async function verifyLocalSnapshot(
	dir: string,
	manifest: CanonicalSnapshotManifest,
): Promise<VerifyFailure[]> {
	const failures: VerifyFailure[] = [];
	for (const partition of manifest.partitions) {
		const path = join(dir, partition.path);
		let size: number;
		try {
			size = (await stat(path)).size;
		} catch {
			failures.push({
				path: partition.path,
				reason: "missing",
				expected: `${partition.byte_size} bytes`,
				actual: "absent",
			});
			continue;
		}
		if (size !== partition.byte_size) {
			failures.push({
				path: partition.path,
				reason: "size-mismatch",
				expected: String(partition.byte_size),
				actual: String(size),
			});
			continue;
		}
		const digest = await sha256File(path);
		if (digest !== partition.sha256) {
			failures.push({
				path: partition.path,
				reason: "digest-mismatch",
				expected: partition.sha256,
				actual: digest,
			});
		}
	}
	return failures;
}

async function headObjectSize(params: {
	client: S3Client;
	bucket: string;
	key: string;
}): Promise<number | null> {
	try {
		const head = await params.client.send(
			new HeadObjectCommand({ Bucket: params.bucket, Key: params.key }),
		);
		return head.ContentLength ?? null;
	} catch (error) {
		if (
			error instanceof NotFound ||
			(error as { $metadata?: { httpStatusCode?: number } })?.$metadata
				?.httpStatusCode === 404
		) {
			return null;
		}
		throw error;
	}
}

export type UploadSnapshotResult = {
	snapshotDigest: string;
	manifestKey: string;
	uploaded: number;
	skipped: number;
	uploadedBytes: number;
};

export async function uploadCanonicalSnapshot(params: {
	dir: string;
	manifest: CanonicalSnapshotManifest;
	client: S3Client;
	bucket: string;
	skipVerify?: boolean;
	dryRun?: boolean;
	log?: (message: string) => void;
}): Promise<UploadSnapshotResult> {
	const { dir, manifest, client, bucket } = params;
	const log = params.log ?? (() => {});

	if (
		manifest.dataset !== CANONICAL_ARCHIVE_DATASET ||
		manifest.schema_version !== CANONICAL_EXPORT_SCHEMA_VERSION
	) {
		throw new Error(
			`not a v1 canonical snapshot manifest (dataset=${manifest.dataset}, schema_version=${manifest.schema_version})`,
		);
	}
	if (!manifest.signature) {
		throw new Error("refusing to upload an unsigned snapshot manifest");
	}
	const snapshotDigest = manifestDigest(manifest);

	if (!params.skipVerify) {
		log(`verifying ${manifest.partitions.length} partitions locally…`);
		const failures = await verifyLocalSnapshot(dir, manifest);
		if (failures.length > 0) {
			const detail = failures
				.slice(0, 5)
				.map(
					(f) =>
						`${f.path} ${f.reason} expected=${f.expected} actual=${f.actual}`,
				)
				.join("; ");
			throw new Error(
				`local snapshot fails verification (${failures.length} objects): ${detail}`,
			);
		}
	}

	let uploaded = 0;
	let skipped = 0;
	let uploadedBytes = 0;
	const progress = createProgressReporter({
		label: "upload",
		total: manifest.partitions.length,
		write: (line) => log(line.trim()),
	});

	for (const [index, partition] of manifest.partitions.entries()) {
		const key = `${CANONICAL_ARCHIVE_PREFIX}/${partition.path}`;
		const existingSize = await headObjectSize({ client, bucket, key });
		if (existingSize === partition.byte_size) {
			skipped++;
			continue;
		}
		if (existingSize !== null) {
			// Same digest-addressed name, different size: a torn upload. Multipart
			// completion is atomic, so this should be impossible — replace it, loudly.
			log(
				`WARNING: ${key} exists with size ${existingSize} != ${partition.byte_size}; replacing`,
			);
		}
		if (params.dryRun) {
			log(`dry-run: would upload ${key} (${partition.byte_size} bytes)`);
			uploaded++;
			uploadedBytes += partition.byte_size;
			continue;
		}
		const upload = new Upload({
			client,
			params: {
				Bucket: bucket,
				Key: key,
				Body: createReadStream(join(dir, partition.path)),
				ContentType: PARQUET_CONTENT_TYPE,
				CacheControl: IMMUTABLE_CACHE,
			},
			partSize: MULTIPART_PART_SIZE,
			queueSize: 4,
			leavePartsOnError: false,
		});
		await upload.done();
		const landedSize = await headObjectSize({ client, bucket, key });
		if (landedSize !== partition.byte_size) {
			throw new Error(
				`upload landed wrong size for ${key}: ${landedSize} != ${partition.byte_size}`,
			);
		}
		uploaded++;
		uploadedBytes += partition.byte_size;
		// Time-based: a count-based line every 25 partitions cannot distinguish
		// "died immediately" from "died at 90%", which is exactly the ambiguity
		// a killed upload left on 2026-08-12.
		progress.tick(
			index + 1,
			`${uploaded} uploaded, ${skipped} skipped, ${(uploadedBytes / 1e9).toFixed(1)} GB`,
		);
	}

	// Manifest last: its presence certifies the objects above it.
	const manifestKey = `${CANONICAL_ARCHIVE_PREFIX}/snapshots/${snapshotDigest}.json`;
	if (!params.dryRun) {
		const existing = await headObjectSize({ client, bucket, key: manifestKey });
		if (existing === null) {
			await putJsonObject({
				client,
				bucket,
				key: manifestKey,
				value: manifest,
			});
		} else {
			log(`manifest already present: ${manifestKey}`);
		}
	} else {
		log(`dry-run: would upload ${manifestKey}`);
	}

	return { snapshotDigest, manifestKey, uploaded, skipped, uploadedBytes };
}

function parseCliArgs(argv: string[]): {
	manifestPath: string | undefined;
	dryRun: boolean;
	skipVerify: boolean;
} {
	let manifestPath: string | undefined;
	let dryRun = false;
	let skipVerify = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--manifest") manifestPath = argv[++i];
		else if (arg === "--dry-run") dryRun = true;
		else if (arg === "--skip-verify") skipVerify = true;
	}
	return { manifestPath, dryRun, skipVerify };
}

async function main(): Promise<void> {
	const args = parseCliArgs(process.argv.slice(2));
	if (!args.manifestPath) {
		throw new Error(
			"--manifest <path to snapshots/<digest>.json> is required; the export dir is derived from it",
		);
	}
	const manifest = await readJsonFile<CanonicalSnapshotManifest>(
		args.manifestPath,
	);
	// snapshots/<digest>.json sits one level below the export root.
	const dir = join(args.manifestPath, "..", "..");

	const config = getStreamsBulkR2ConfigFromEnv();
	const client = createStreamsBulkS3Client(config);
	const result = await uploadCanonicalSnapshot({
		dir,
		manifest,
		client,
		bucket: config.bucket,
		dryRun: args.dryRun,
		skipVerify: args.skipVerify,
		log: (message) => console.error(message),
	});
	console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(
			"upload-snapshot failed:",
			error instanceof Error ? error.message : error,
		);
		process.exit(1);
	});
}
