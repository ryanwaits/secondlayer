#!/usr/bin/env bun
/**
 * Promote an uploaded snapshot to `latest.json` — the archive's root pointer.
 *
 * Everything upstream of this is append-only and harmless: partitions and
 * snapshot manifests are immutable and digest-addressed, so publishing a bad
 * one costs storage and nothing else. `latest.json` is the single mutable
 * object in the tree, and it is what consumers resolve first. A wrong value
 * here is the only way this archive can actively mislead someone.
 *
 * So promotion is the one place that refuses on suspicion rather than proof of
 * harm. Every check below must pass, and each exists because its absence would
 * let a specific bad state become "latest":
 *
 *  - signature invalid → an unsigned or forged snapshot becomes canonical
 *  - object missing / wrong size → consumers 404 or read truncated data
 *  - non-contiguous coverage → a chain with holes presents as complete
 *  - regression → a shorter or older snapshot silently rolls consumers back
 *
 * Dry-run by default. `latest.json` is written last and in one PUT, so a
 * consumer either sees the old pointer or the new one, never a partial.
 *
 * Usage:
 *   bun run packages/indexer/src/archive/promote-snapshot.ts --manifest <path>
 *   bun run packages/indexer/src/archive/promote-snapshot.ts --manifest <path> --apply
 */
import { HeadObjectCommand, NotFound, type S3Client } from "@aws-sdk/client-s3";
import { publicKeyPemFromPrivate } from "@secondlayer/shared/crypto/ed25519";
import { verifyStreamsBulkManifestSignature } from "@secondlayer/shared/streams-bulk-manifest";
import { signStreamsBulkManifest } from "@secondlayer/shared/streams-bulk-manifest";
import { readJsonFile } from "../streams-bulk/file.ts";
import {
	createStreamsBulkS3Client,
	getJsonObject,
	getStreamsBulkR2ConfigFromEnv,
	putJsonObject,
} from "../streams-bulk/upload.ts";
import {
	CANONICAL_ARCHIVE_DATASET,
	CANONICAL_ARCHIVE_VERSION,
	type CanonicalSnapshotManifest,
	manifestDigest,
} from "./export-snapshot.ts";
import { CANONICAL_ARCHIVE_PREFIX } from "./upload-snapshot.ts";

export const LATEST_SCHEMA_VERSION = 1;

export type CanonicalLatestPointer = {
	schema_version: typeof LATEST_SCHEMA_VERSION;
	dataset: typeof CANONICAL_ARCHIVE_DATASET;
	version: typeof CANONICAL_ARCHIVE_VERSION;
	network: string;
	snapshot_digest: string;
	snapshot_path: string;
	coverage: { from_block: number; to_block: number };
	counts: { blocks: number; transactions: number; events: number };
	assurance: string;
	finality_rule: CanonicalSnapshotManifest["finality_rule"];
	promoted_at: string;
	signature?: string;
	key_id?: string;
};

export type PromotionCheck = {
	name: string;
	passed: boolean;
	detail: string;
};

/**
 * Coverage must tile the declared range with no holes. A missing partition in
 * the middle is the dangerous case: counts still look plausible, and the gap
 * only surfaces when someone queries into it.
 */
export function checkCoverageContiguous(
	manifest: CanonicalSnapshotManifest,
): PromotionCheck {
	const size = manifest.partition_size_blocks;
	const { from_block, to_block } = manifest.coverage;
	const expected: string[] = [];
	for (let start = from_block; start <= to_block; start += size) {
		expected.push(`${start}-${Math.min(start + size - 1, to_block)}`);
	}

	// A range is covered if it either shipped an object or was explicitly
	// declared empty. Silence is not coverage.
	const covered = new Set<string>();
	for (const p of manifest.partitions) {
		if (p.dataset === "blocks") covered.add(`${p.from_block}-${p.to_block}`);
	}
	for (const z of manifest.zero_record_ranges) {
		if (z.dataset === "blocks") covered.add(`${z.from_block}-${z.to_block}`);
	}

	const missing = expected.filter((range) => !covered.has(range));
	return {
		name: "coverage contiguous",
		passed: missing.length === 0,
		detail:
			missing.length === 0
				? `${expected.length} block ranges tile [${from_block}, ${to_block}]`
				: `${missing.length} uncovered ranges, first: ${missing[0]}`,
	};
}

export function checkNoRegression(
	manifest: CanonicalSnapshotManifest,
	current: CanonicalLatestPointer | null,
): PromotionCheck {
	if (!current) {
		return {
			name: "no regression",
			passed: true,
			detail: "no existing latest.json — first promotion",
		};
	}
	if (current.network !== manifest.network) {
		return {
			name: "no regression",
			passed: false,
			detail: `network mismatch: latest is ${current.network}, candidate is ${manifest.network}`,
		};
	}
	const advances = manifest.coverage.to_block >= current.coverage.to_block;
	return {
		name: "no regression",
		passed: advances,
		detail: advances
			? `advances ${current.coverage.to_block} → ${manifest.coverage.to_block}`
			: `candidate tip ${manifest.coverage.to_block} is BEHIND current ${current.coverage.to_block}`,
	};
}

async function headSize(params: {
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

export async function checkObjectsPresent(params: {
	client: S3Client;
	bucket: string;
	manifest: CanonicalSnapshotManifest;
	onProgress?: (checked: number, total: number) => void;
}): Promise<PromotionCheck> {
	const { manifest } = params;
	const problems: string[] = [];
	let checked = 0;
	for (const partition of manifest.partitions) {
		const key = `${CANONICAL_ARCHIVE_PREFIX}/${partition.path}`;
		const size = await headSize({ ...params, key });
		if (size === null) {
			problems.push(`${partition.path} missing`);
		} else if (size !== partition.byte_size) {
			problems.push(`${partition.path} size ${size} != ${partition.byte_size}`);
		}
		checked++;
		params.onProgress?.(checked, manifest.partitions.length);
	}
	return {
		name: "objects present",
		passed: problems.length === 0,
		detail:
			problems.length === 0
				? `${manifest.partitions.length} objects present at declared sizes`
				: `${problems.length} problems, first: ${problems[0]}`,
	};
}

export function checkSignature(
	manifest: CanonicalSnapshotManifest,
	publicKeyPem: string | undefined,
): PromotionCheck {
	if (!manifest.signature) {
		return {
			name: "signature",
			passed: false,
			detail: "manifest is unsigned",
		};
	}
	if (!publicKeyPem) {
		return {
			name: "signature",
			passed: false,
			detail:
				"no public key available (set STREAMS_SIGNING_PRIVATE_KEY or STREAMS_SIGNING_PUBLIC_KEY)",
		};
	}
	const verified = verifyStreamsBulkManifestSignature(
		manifest as unknown as Record<string, unknown>,
		publicKeyPem,
	);
	return {
		name: "signature",
		passed: verified,
		detail: verified ? `verified (key ${manifest.key_id})` : "did NOT verify",
	};
}

function resolvePublicKeyPem(): string | undefined {
	const explicit = process.env.STREAMS_SIGNING_PUBLIC_KEY;
	if (explicit)
		return explicit.includes("\\n") ? explicit.replace(/\\n/g, "\n") : explicit;
	const priv = process.env.STREAMS_SIGNING_PRIVATE_KEY;
	if (!priv) return undefined;
	const pem = priv.includes("\\n") ? priv.replace(/\\n/g, "\n") : priv;
	return publicKeyPemFromPrivate(pem);
}

function parseArgs(argv: string[]): { manifestPath?: string; apply: boolean } {
	let manifestPath: string | undefined;
	let apply = false;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--manifest") manifestPath = argv[++i];
		else if (argv[i] === "--apply") apply = true;
	}
	return { manifestPath, apply };
}

async function main(): Promise<void> {
	const { manifestPath, apply } = parseArgs(process.argv.slice(2));
	if (!manifestPath) throw new Error("--manifest <path> is required");

	const manifest = await readJsonFile<CanonicalSnapshotManifest>(manifestPath);
	const snapshotDigest = manifestDigest(manifest);
	const config = getStreamsBulkR2ConfigFromEnv();
	const client = createStreamsBulkS3Client(config);
	const latestKey = `${CANONICAL_ARCHIVE_PREFIX}/latest.json`;

	const current = await getJsonObject<CanonicalLatestPointer>({
		client,
		bucket: config.bucket,
		key: latestKey,
	});

	console.log(`snapshot         ${snapshotDigest}`);
	console.log(
		`coverage         ${manifest.coverage.from_block} → ${manifest.coverage.to_block}`,
	);
	console.log(`current latest   ${current?.snapshot_digest ?? "(none)"}`);
	console.log("");

	const checks: PromotionCheck[] = [
		checkSignature(manifest, resolvePublicKeyPem()),
		checkCoverageContiguous(manifest),
		checkNoRegression(manifest, current),
		await checkObjectsPresent({
			client,
			bucket: config.bucket,
			manifest,
			onProgress: (checked, total) => {
				if (checked % 100 === 0) {
					console.error(`  checked ${checked}/${total} objects`);
				}
			},
		}),
	];
	// The snapshot manifest itself must be in the bucket, or `latest.json`
	// would point at something that does not exist.
	const manifestKey = `${CANONICAL_ARCHIVE_PREFIX}/snapshots/${snapshotDigest}.json`;
	checks.push({
		name: "snapshot manifest uploaded",
		passed:
			(await headSize({ client, bucket: config.bucket, key: manifestKey })) !==
			null,
		detail: manifestKey,
	});

	for (const check of checks) {
		console.log(
			`${check.passed ? "PASS" : "FAIL"}  ${check.name}  ${check.detail}`,
		);
	}
	const failed = checks.filter((c) => !c.passed);
	if (failed.length > 0) {
		console.log(`\nRefusing to promote: ${failed.length} checks failed.`);
		process.exitCode = 2;
		return;
	}

	let pointer: CanonicalLatestPointer = {
		schema_version: LATEST_SCHEMA_VERSION,
		dataset: CANONICAL_ARCHIVE_DATASET,
		version: CANONICAL_ARCHIVE_VERSION,
		network: manifest.network,
		snapshot_digest: snapshotDigest,
		snapshot_path: `snapshots/${snapshotDigest}.json`,
		coverage: manifest.coverage,
		counts: manifest.counts,
		assurance: manifest.assurance,
		finality_rule: manifest.finality_rule,
		promoted_at: new Date().toISOString(),
	};
	const privateKey = process.env.STREAMS_SIGNING_PRIVATE_KEY;
	if (privateKey) {
		pointer = signStreamsBulkManifest(
			pointer as unknown as Record<string, unknown>,
			privateKey,
		) as unknown as CanonicalLatestPointer;
	}

	if (!apply) {
		console.log("\n(dry-run — pass --apply to promote)");
		console.log(JSON.stringify(pointer, null, 2));
		return;
	}

	await putJsonObject({
		client,
		bucket: config.bucket,
		key: latestKey,
		value: pointer,
	});
	console.log(`\nPromoted ${snapshotDigest} to ${latestKey}`);
}

if (import.meta.main) {
	main().catch((err) => {
		console.error(
			"promote-snapshot failed:",
			err instanceof Error ? err.message : err,
		);
		process.exit(1);
	});
}
