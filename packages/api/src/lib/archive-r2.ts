import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * R2 client + presigner for the archive fetch gate (`routes/archive.ts`).
 *
 * Deliberately NOT imported from `@secondlayer/indexer/streams-bulk/upload`
 * — the API must not depend on the indexer package for this. Reads the
 * SAME `STREAMS_BULK_R2_*` env vars the publisher does (no new env
 * plumbing); the small duplication of the config reader + client factory
 * against `packages/indexer/src/streams-bulk/upload.ts` is accepted.
 * Consolidating both into `@secondlayer/shared` is follow-up, not done here.
 *
 * `getArchiveR2ConfigFromEnv` returns `null` (never throws) when the env is
 * unset, so importing this module never crashes an OSS-mode boot — the
 * route checks for `null` and answers 503 instead of mounting broken.
 */

export type ArchiveR2Config = {
	endpoint: string;
	accessKeyId: string;
	secretAccessKey: string;
	bucket: string;
};

export function getArchiveR2ConfigFromEnv(): ArchiveR2Config | null {
	const endpoint = process.env.STREAMS_BULK_R2_ENDPOINT;
	const accessKeyId = process.env.STREAMS_BULK_R2_ACCESS_KEY_ID;
	const secretAccessKey = process.env.STREAMS_BULK_R2_SECRET_ACCESS_KEY;
	const bucket = process.env.STREAMS_BULK_R2_BUCKET;
	if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return null;
	return { endpoint, accessKeyId, secretAccessKey, bucket };
}

export function createArchiveS3Client(config: ArchiveR2Config): S3Client {
	return new S3Client({
		region: "auto",
		endpoint: config.endpoint,
		forcePathStyle: true,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
		},
	});
}

/** Presigned GET URL TTL — long enough for a `sl bootstrap` operator to
 *  start the download after confirming the quote, short enough that a
 *  leaked URL isn't a standing liability. */
export const ARCHIVE_PRESIGN_TTL_SECONDS = 900;

export async function presignArchiveObject(params: {
	client: S3Client;
	bucket: string;
	key: string;
}): Promise<string> {
	const command = new GetObjectCommand({
		Bucket: params.bucket,
		Key: params.key,
	});
	return getSignedUrl(params.client, command, {
		expiresIn: ARCHIVE_PRESIGN_TTL_SECONDS,
	});
}
