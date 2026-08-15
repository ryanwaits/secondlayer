#!/usr/bin/env bun
/**
 * Publish `status.json` — the archive's operational truth.
 *
 * Every other object in the tree is immutable and signed, which makes them
 * durable but silent: a consumer holding a valid manifest cannot tell whether
 * it is current or the last thing published before an incident. This is the one
 * object allowed to say something unflattering, so it is derived from measured
 * state and never from an assertion by the publisher.
 *
 * Cache-short by design (`max-age=60`): a stale status object is worse than no
 * status object, because it launders an outage into apparent health.
 *
 * Usage:
 *   bun run packages/indexer/src/archive/publish-status.ts           # dry-run
 *   bun run packages/indexer/src/archive/publish-status.ts --apply
 */
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
	type ArchiveStatus,
	deriveArchiveStatus,
} from "@secondlayer/shared/archive/status";
import { closeDb, getSourceDb } from "@secondlayer/shared/db";
import { signStreamsBulkManifest } from "@secondlayer/shared/streams-bulk-manifest";
import {
	createStreamsBulkS3Client,
	getJsonObject,
	getStreamsBulkR2ConfigFromEnv,
} from "../streams-bulk/upload.ts";
import { resolveFinalizedBound } from "./canonical-audit.ts";
import type { CanonicalLatestPointer } from "./promote-snapshot.ts";
import { mirrorToPublicArchive } from "./public-mirror.ts";
import { CANONICAL_ARCHIVE_PREFIX } from "./upload-snapshot.ts";

/** Most recent audit report written by the nightly job, if readable. */
async function readLatestAudit(): Promise<{
	complete: boolean;
	checkedAt: string;
} | null> {
	// Default matches where `canonical-audit-alert.sh` writes: inside the
	// archive volume, which is the only host path mounted into this container.
	const dir = process.env.CANONICAL_AUDIT_REPORT_DIR ?? "/data/archive/audits";
	try {
		const { readdir, readFile } = await import("node:fs/promises");
		const files = (await readdir(dir))
			.filter((f) => f.startsWith("canonical-audit-") && f.endsWith(".json"))
			.sort();
		const newest = files[files.length - 1];
		if (!newest) return null;
		const report = JSON.parse(await readFile(`${dir}/${newest}`, "utf8")) as {
			continuity?: { complete?: boolean };
			generated_at?: string;
		};
		return {
			complete: report.continuity?.complete === true,
			checkedAt: report.generated_at ?? new Date().toISOString(),
		};
	} catch {
		// No audit report readable — reported as `audit: null` rather than
		// assumed passing.
		return null;
	}
}

export async function buildStatus(): Promise<ArchiveStatus> {
	const config = getStreamsBulkR2ConfigFromEnv();
	const client = createStreamsBulkS3Client(config);
	const pointer = await getJsonObject<CanonicalLatestPointer>({
		client,
		bucket: config.bucket,
		key: `${CANONICAL_ARCHIVE_PREFIX}/latest.json`,
	});

	// Source measurements. Failure here is reported, not swallowed into health.
	let sourceTipHeight: number | null = null;
	let finalizedHeight: number | null = null;
	try {
		const db = getSourceDb();
		const bound = await resolveFinalizedBound(db);
		finalizedHeight = bound.toBlock;
		const tip = await db
			.selectFrom("blocks")
			.select("height")
			.where("canonical", "=", true)
			.orderBy("height", "desc")
			.limit(1)
			.executeTakeFirst();
		sourceTipHeight = tip ? Number(tip.height) : null;
	} catch {
		sourceTipHeight = null;
		finalizedHeight = null;
	}

	return deriveArchiveStatus({
		network: process.env.STACKS_NETWORK ?? "mainnet",
		snapshotDigest: pointer?.snapshot_digest ?? null,
		coverageToBlock: pointer?.coverage?.to_block ?? null,
		promotedAt: pointer?.promoted_at ?? null,
		signingKeyId: pointer?.key_id ?? null,
		sourceTipHeight,
		finalizedHeight,
		audit: await readLatestAudit(),
		now: new Date(),
	});
}

async function main(): Promise<void> {
	const apply = process.argv.includes("--apply");
	let status = await buildStatus();

	const privateKey = process.env.STREAMS_SIGNING_PRIVATE_KEY;
	if (privateKey) {
		status = signStreamsBulkManifest(
			status as unknown as Record<string, unknown>,
			privateKey,
		) as unknown as ArchiveStatus;
	}

	console.log(JSON.stringify(status, null, 2));

	if (!apply) {
		console.error("\n(dry-run — pass --apply to publish)");
		await closeDb();
		return;
	}

	const config = getStreamsBulkR2ConfigFromEnv();
	const client = createStreamsBulkS3Client(config);
	await client.send(
		new PutObjectCommand({
			Bucket: config.bucket,
			Key: `${CANONICAL_ARCHIVE_PREFIX}/status.json`,
			Body: `${JSON.stringify(status, null, 2)}\n`,
			ContentType: "application/json; charset=utf-8",
			// Short cache: a cached-healthy status during an outage is the exact
			// failure this object exists to prevent.
			CacheControl: "public, max-age=60",
		}),
	);
	console.error(
		`\nPublished status (${status.state}) to ${CANONICAL_ARCHIVE_PREFIX}/status.json`,
	);

	// The served tree is a separate surface from the bucket. Publishing to one
	// and not the other is how `status.json` came to 404 publicly while the
	// hourly refresh reported success.
	const mirrored = await mirrorToPublicArchive({
		name: "status.json",
		value: status,
	});
	if (mirrored) console.error(`Mirrored status to ${mirrored}`);

	await closeDb();
}

if (import.meta.main) {
	main().catch(async (err) => {
		console.error(
			"publish-status failed:",
			err instanceof Error ? err.message : err,
		);
		await closeDb().catch(() => {});
		process.exit(1);
	});
}
