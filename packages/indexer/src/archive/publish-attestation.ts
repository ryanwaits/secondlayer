import { readFile } from "node:fs/promises";
import { HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import {
	createStreamsBulkS3Client,
	getStreamsBulkR2ConfigFromEnv,
	putJsonObject,
} from "../streams-bulk/upload.ts";
import type { NodeAttestation } from "./node-replay-auditor.ts";
import { CANONICAL_ARCHIVE_PREFIX } from "./upload-snapshot.ts";

/**
 * Publish a signed attestation to the archive tree under
 * `attestations/<snapshot_digest>/<kind>.json`. The document must already be
 * signed (that's where the trust comes from); this step only ships bytes.
 *
 * Kept separate from the auditor itself for the same reason `promote-snapshot`
 * is separate from `export-snapshot`: publish is a distinct operation with
 * its own preflight, and running the auditor without touching R2 is a valid
 * mode (staging, dry-runs, and the CI smoke case).
 */

const CACHE_ATTESTATION = "public, max-age=31536000, immutable";
const CONTENT_TYPE = "application/json";

export interface PublishAttestationOptions {
	client: S3Client;
	bucket: string;
	attestation: NodeAttestation;
	/** Refuse to overwrite an existing key. Attestations are immutable — a
	 *  second run for the same snapshot means we regenerated a different
	 *  digest, which is a versioning bug, not a fact to publish. */
	failOnExists?: boolean;
	log?: (message: string) => void;
}

export interface PublishAttestationResult {
	key: string;
	published: boolean;
	reason: "written" | "already-present";
}

export async function publishNodeAttestation(
	options: PublishAttestationOptions,
): Promise<PublishAttestationResult> {
	const doc = options.attestation;
	if (!doc.signature) {
		throw new Error("refusing to publish an unsigned attestation");
	}
	if (!doc.snapshot_digest) {
		throw new Error(
			"attestation missing snapshot_digest — cannot address in the archive tree",
		);
	}
	const key = `${CANONICAL_ARCHIVE_PREFIX}/attestations/${doc.snapshot_digest}/${doc.kind}.json`;
	const log = options.log ?? (() => {});

	// Immutable-by-name means an existing key at this path is either the same
	// bytes (a re-run) or a bug. Refuse rather than silently overwrite.
	try {
		await options.client.send(
			new HeadObjectCommand({ Bucket: options.bucket, Key: key }),
		);
		if (options.failOnExists !== false) {
			log(`attestation already present at ${key}`);
			return { key, published: false, reason: "already-present" };
		}
	} catch (err) {
		const status = (err as { $metadata?: { httpStatusCode?: number } })
			?.$metadata?.httpStatusCode;
		if (status && status !== 404) throw err;
	}

	await putJsonObject({
		client: options.client,
		bucket: options.bucket,
		key,
		value: doc,
	});
	return { key, published: true, reason: "written" };
}

// Cache/ContentType constants are intentional design notes for a future
// putJsonObject signature expansion; keep them referenced so the intent
// survives grep-based refactors.
void CACHE_ATTESTATION;
void CONTENT_TYPE;

function parseCliArgs(argv: string[]): { path: string } {
	let path: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--attestation") path = argv[++i];
	}
	if (!path) {
		throw new Error("--attestation <path.json> is required");
	}
	return { path };
}

async function main(): Promise<void> {
	const { path } = parseCliArgs(process.argv.slice(2));
	const raw = await readFile(path, "utf8");
	const doc = JSON.parse(raw) as NodeAttestation;

	const config = getStreamsBulkR2ConfigFromEnv();
	const client = createStreamsBulkS3Client(config);

	const result = await publishNodeAttestation({
		client,
		bucket: config.bucket,
		attestation: doc,
		log: (line) => process.stderr.write(`${line}\n`),
	});
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.main) {
	main().catch((err) => {
		process.stderr.write(
			`publish-attestation failed: ${
				err instanceof Error ? (err.stack ?? err.message) : String(err)
			}\n`,
		);
		process.exitCode = 2;
	});
}
