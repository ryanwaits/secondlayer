import { describe, expect, test } from "bun:test";
import type { S3Client } from "@aws-sdk/client-s3";
import { SEMANTIC_DIGEST_SPEC_V1 } from "@secondlayer/shared/archive/semantic-digest";
import type { CanonicalSnapshotManifest } from "./export-snapshot.ts";
import {
	type CanonicalLatestPointer,
	checkCoverageContiguous,
	checkNoRegression,
	checkObjectsPresent,
	checkSignature,
} from "./promote-snapshot.ts";

/**
 * `latest.json` is the only mutable object in the archive and the first thing
 * a consumer resolves, so a wrong value here is the one way this archive can
 * actively mislead. Each test below pins a specific bad state OUT of it.
 */

function manifest(
	overrides: Partial<CanonicalSnapshotManifest> = {},
): CanonicalSnapshotManifest {
	return {
		schema_version: 1,
		dataset: "secondlayer-canonical",
		version: "v1",
		network: "mainnet",
		generated_at: "2026-01-01T00:00:00.000Z",
		assurance: "db-reconstructive",
		source: "postgres-canonical-snapshot",
		finality_rule: {
			type: "bitcoin-confirmations",
			confirmations: 6,
			source_burn_tip: 100,
			finalized_burn_height: 94,
		},
		coverage: { from_block: 0, to_block: 199 },
		genesis: { height: 0, hash: "0xg" },
		archive_tip: { height: 199, hash: "0xt" },
		source_tip: { height: 199, hash: "0xt" },
		counts: { blocks: 200, transactions: 0, events: 0 },
		partition_size_blocks: 100,
		partitions: [
			{
				dataset: "blocks",
				from_block: 0,
				to_block: 99,
				path: "blocks/0-99-a.parquet",
				row_count: 100,
				byte_size: 10,
				sha256: "a",
				semantic_digest: "sem-a",
				semantic_digest_spec: SEMANTIC_DIGEST_SPEC_V1,
			},
			{
				dataset: "blocks",
				from_block: 100,
				to_block: 199,
				path: "blocks/100-199-b.parquet",
				row_count: 100,
				byte_size: 20,
				sha256: "b",
				semantic_digest: "sem-b",
				semantic_digest_spec: SEMANTIC_DIGEST_SPEC_V1,
			},
		],
		zero_record_ranges: [],
		range_digests: [],
		partition_semantic_digests: [],
		assurance_ranges: [],
		audit: {} as never,
		signature: "sig",
		key_id: "key",
		...overrides,
	};
}

function fakeClient(sizes: Map<string, number>): S3Client {
	return {
		send: async (command: {
			constructor: { name: string };
			input: { Key: string };
		}) => {
			const size = sizes.get(command.input.Key);
			if (size === undefined) {
				const error = new Error("not found") as Error & {
					$metadata: { httpStatusCode: number };
				};
				error.$metadata = { httpStatusCode: 404 };
				throw error;
			}
			return { ContentLength: size };
		},
	} as unknown as S3Client;
}

const PREFIX = "secondlayer/mainnet/canonical/v1";

describe("promotion guards", () => {
	test("contiguous coverage passes", () => {
		expect(checkCoverageContiguous(manifest()).passed).toBe(true);
	});

	test("a hole in the middle is refused", () => {
		// The dangerous case: counts look plausible and only a query into the
		// gap reveals it.
		const m = manifest({
			coverage: { from_block: 0, to_block: 299 },
			partitions: [
				{
					dataset: "blocks",
					from_block: 0,
					to_block: 99,
					path: "blocks/a",
					row_count: 100,
					byte_size: 1,
					sha256: "a",
					semantic_digest: "sem-a",
					semantic_digest_spec: SEMANTIC_DIGEST_SPEC_V1,
				},
				{
					dataset: "blocks",
					from_block: 200,
					to_block: 299,
					path: "blocks/c",
					row_count: 100,
					byte_size: 1,
					sha256: "c",
					semantic_digest: "sem-c",
					semantic_digest_spec: SEMANTIC_DIGEST_SPEC_V1,
				},
			],
		});
		const check = checkCoverageContiguous(m);
		expect(check.passed).toBe(false);
		expect(check.detail).toContain("100-199");
	});

	test("an explicitly empty range counts as covered", () => {
		const m = manifest({
			partitions: [
				{
					dataset: "blocks",
					from_block: 0,
					to_block: 99,
					path: "blocks/a",
					row_count: 100,
					byte_size: 1,
					sha256: "a",
					semantic_digest: "sem-a",
					semantic_digest_spec: SEMANTIC_DIGEST_SPEC_V1,
				},
			],
			zero_record_ranges: [
				{ dataset: "blocks", from_block: 100, to_block: 199 },
			],
		});
		expect(checkCoverageContiguous(m).passed).toBe(true);
	});

	test("a shorter snapshot cannot replace a longer one", () => {
		const current: CanonicalLatestPointer = {
			schema_version: 1,
			dataset: "secondlayer-canonical",
			version: "v1",
			network: "mainnet",
			snapshot_digest: "old",
			snapshot_path: "snapshots/old.json",
			coverage: { from_block: 0, to_block: 500 },
			counts: { blocks: 501, transactions: 0, events: 0 },
			assurance: "db-reconstructive",
			finality_rule: manifest().finality_rule,
			promoted_at: "2026-01-01T00:00:00.000Z",
		};
		const check = checkNoRegression(manifest(), current);
		expect(check.passed).toBe(false);
		expect(check.detail).toContain("BEHIND");
	});

	test("a snapshot for a different network is refused", () => {
		const current: CanonicalLatestPointer = {
			schema_version: 1,
			dataset: "secondlayer-canonical",
			version: "v1",
			network: "testnet",
			snapshot_digest: "old",
			snapshot_path: "snapshots/old.json",
			coverage: { from_block: 0, to_block: 10 },
			counts: { blocks: 11, transactions: 0, events: 0 },
			assurance: "db-reconstructive",
			finality_rule: manifest().finality_rule,
			promoted_at: "2026-01-01T00:00:00.000Z",
		};
		expect(checkNoRegression(manifest(), current).passed).toBe(false);
	});

	test("first promotion is allowed", () => {
		expect(checkNoRegression(manifest(), null).passed).toBe(true);
	});

	test("an unsigned manifest is refused", () => {
		const m = manifest();
		m.signature = undefined;
		expect(checkSignature(m, "pem").passed).toBe(false);
	});

	test("a missing public key refuses rather than assuming", () => {
		expect(checkSignature(manifest(), undefined).passed).toBe(false);
	});

	test("all objects present at declared sizes passes", async () => {
		const sizes = new Map([
			[`${PREFIX}/blocks/0-99-a.parquet`, 10],
			[`${PREFIX}/blocks/100-199-b.parquet`, 20],
		]);
		const check = await checkObjectsPresent({
			client: fakeClient(sizes),
			bucket: "b",
			manifest: manifest(),
		});
		expect(check.passed).toBe(true);
	});

	test("a missing object is refused", async () => {
		const sizes = new Map([[`${PREFIX}/blocks/0-99-a.parquet`, 10]]);
		const check = await checkObjectsPresent({
			client: fakeClient(sizes),
			bucket: "b",
			manifest: manifest(),
		});
		expect(check.passed).toBe(false);
		expect(check.detail).toContain("missing");
	});

	test("a truncated object is refused", async () => {
		// Same name, wrong bytes — a partial upload that a naive existence check
		// would wave through.
		const sizes = new Map([
			[`${PREFIX}/blocks/0-99-a.parquet`, 10],
			[`${PREFIX}/blocks/100-199-b.parquet`, 19],
		]);
		const check = await checkObjectsPresent({
			client: fakeClient(sizes),
			bucket: "b",
			manifest: manifest(),
		});
		expect(check.passed).toBe(false);
		expect(check.detail).toContain("size");
	});
});
