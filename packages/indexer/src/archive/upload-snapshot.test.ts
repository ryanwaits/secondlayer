import { beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import { SEMANTIC_DIGEST_SPEC_V1 } from "@secondlayer/shared/archive/semantic-digest";
import type { CanonicalSnapshotManifest } from "./export-snapshot.ts";
import {
	uploadCanonicalSnapshot,
	verifyLocalSnapshot,
} from "./upload-snapshot.ts";

/**
 * The uploader's contract, without a bucket: the local verification gate
 * refuses corrupted trees, resume skips objects that already landed, and the
 * manifest never uploads ahead of its partitions. S3 is a fake that records
 * the order of every call.
 */

let dir: string;
let manifest: CanonicalSnapshotManifest;

async function writePartition(path: string, content: string) {
	const full = join(dir, path);
	await mkdir(dirname(full), { recursive: true });
	await writeFile(full, content);
	return {
		byte_size: Buffer.byteLength(content),
		sha256: createHash("sha256").update(content).digest("hex"),
	};
}

function baseManifest(
	partitions: CanonicalSnapshotManifest["partitions"],
): CanonicalSnapshotManifest {
	return {
		schema_version: 1,
		dataset: "secondlayer-canonical",
		version: "v1",
		network: "testnet",
		generated_at: "2026-01-01T00:00:00.000Z",
		assurance: "db-reconstructive",
		source: "postgres-canonical-snapshot",
		finality_rule: {
			type: "bitcoin-confirmations",
			confirmations: 6,
			source_burn_tip: 100,
			finalized_burn_height: 94,
		},
		coverage: { from_block: 0, to_block: 9 },
		genesis: { height: 0, hash: "0xb0" },
		archive_tip: { height: 9, hash: "0xb9" },
		source_tip: { height: 9, hash: "0xb9" },
		counts: { blocks: 10, transactions: 0, events: 0 },
		partition_size_blocks: 10,
		partitions,
		zero_record_ranges: [],
		range_digests: [],
		partition_semantic_digests: [],
		assurance_ranges: [],
		audit: { continuity: { complete: true } } as never,
		signature: "test-signature",
		key_id: "test-key",
	};
}

type FakeCall = { kind: "head" | "put-json" | "multipart"; key: string };

/** Records call order; HEAD returns sizes from `existing`, 404 otherwise. */
function fakeClient(
	existing: Map<string, number>,
	calls: FakeCall[],
): S3Client {
	return {
		send: async (command: {
			constructor: { name: string };
			input: { Key: string; Body?: unknown };
		}) => {
			const key = command.input.Key;
			if (command.constructor.name === "HeadObjectCommand") {
				calls.push({ kind: "head", key });
				const size = existing.get(key);
				if (size === undefined) {
					const error = new Error("not found") as Error & {
						$metadata: { httpStatusCode: number };
					};
					error.$metadata = { httpStatusCode: 404 };
					throw error;
				}
				return { ContentLength: size };
			}
			if (command.constructor.name === "PutObjectCommand") {
				calls.push({ kind: "put-json", key });
				existing.set(key, Buffer.byteLength(String(command.input.Body)));
				return {};
			}
			throw new Error(`unexpected command: ${command.constructor.name}`);
		},
	} as unknown as S3Client;
}

beforeEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
	dir = await mkdtemp(join(tmpdir(), "upload-snapshot-"));
	const a = await writePartition("blocks/0-9-aaaa.parquet", "blocks-bytes");
	const b = await writePartition("events/0-9-bbbb.parquet", "events-bytes");
	manifest = baseManifest([
		{
			dataset: "blocks",
			from_block: 0,
			to_block: 9,
			path: "blocks/0-9-aaaa.parquet",
			row_count: 10,
			...a,
			semantic_digest: "sem-a",
			semantic_digest_spec: SEMANTIC_DIGEST_SPEC_V1,
		},
		{
			dataset: "events",
			from_block: 0,
			to_block: 9,
			path: "events/0-9-bbbb.parquet",
			row_count: 3,
			...b,
			semantic_digest: "sem-b",
			semantic_digest_spec: SEMANTIC_DIGEST_SPEC_V1,
		},
	]);
});

describe("verifyLocalSnapshot", () => {
	test("passes a tree that matches the manifest exactly", async () => {
		expect(await verifyLocalSnapshot(dir, manifest)).toEqual([]);
	});

	test("reports a corrupted partition as a digest mismatch", async () => {
		await writeFile(join(dir, "blocks/0-9-aaaa.parquet"), "blocks-bytez");
		const failures = await verifyLocalSnapshot(dir, manifest);
		expect(failures).toHaveLength(1);
		expect(failures[0]?.reason).toBe("digest-mismatch");
	});

	test("reports truncation and absence distinctly", async () => {
		await writeFile(join(dir, "blocks/0-9-aaaa.parquet"), "short");
		await rm(join(dir, "events/0-9-bbbb.parquet"));
		const reasons = (await verifyLocalSnapshot(dir, manifest)).map(
			(f) => f.reason,
		);
		expect(reasons.sort()).toEqual(["missing", "size-mismatch"]);
	});
});

describe("uploadCanonicalSnapshot", () => {
	test("refuses an unsigned manifest", async () => {
		const { signature: _s, key_id: _k, ...unsigned } = manifest;
		expect(
			uploadCanonicalSnapshot({
				dir,
				manifest: unsigned as CanonicalSnapshotManifest,
				client: fakeClient(new Map(), []),
				bucket: "b",
			}),
		).rejects.toThrow(/unsigned/);
	});

	test("refuses to touch the bucket when local verification fails", async () => {
		await writeFile(join(dir, "blocks/0-9-aaaa.parquet"), "tampered!!!!");
		const calls: FakeCall[] = [];
		expect(
			uploadCanonicalSnapshot({
				dir,
				manifest,
				client: fakeClient(new Map(), calls),
				bucket: "b",
			}),
		).rejects.toThrow(/fails verification/);
		expect(calls).toHaveLength(0);
	});

	test("skips objects that already landed and uploads the manifest last", async () => {
		const calls: FakeCall[] = [];
		const existing = new Map<string, number>([
			[
				"secondlayer/mainnet/canonical/v1/blocks/0-9-aaaa.parquet",
				Buffer.byteLength("blocks-bytes"),
			],
		]);
		// dryRun exercises resume/ordering without the multipart machinery.
		const result = await uploadCanonicalSnapshot({
			dir,
			manifest,
			client: fakeClient(existing, calls),
			bucket: "b",
			dryRun: true,
		});
		expect(result.skipped).toBe(1);
		expect(result.uploaded).toBe(1);
		expect(result.uploadedBytes).toBe(Buffer.byteLength("events-bytes"));
		// Every partition HEAD precedes any manifest write; dry-run writes none.
		expect(calls.every((c) => c.kind === "head")).toBe(true);
	});

	test("writes the manifest only after all partitions exist", async () => {
		const calls: FakeCall[] = [];
		const existing = new Map<string, number>([
			[
				"secondlayer/mainnet/canonical/v1/blocks/0-9-aaaa.parquet",
				Buffer.byteLength("blocks-bytes"),
			],
			[
				"secondlayer/mainnet/canonical/v1/events/0-9-bbbb.parquet",
				Buffer.byteLength("events-bytes"),
			],
		]);
		const result = await uploadCanonicalSnapshot({
			dir,
			manifest,
			client: fakeClient(existing, calls),
			bucket: "b",
		});
		expect(result.uploaded).toBe(0);
		expect(result.skipped).toBe(2);
		const putIndex = calls.findIndex((c) => c.kind === "put-json");
		expect(putIndex).toBe(calls.length - 1);
		expect(calls[putIndex]?.key).toBe(
			`secondlayer/mainnet/canonical/v1/snapshots/${result.snapshotDigest}.json`,
		);
	});
});
