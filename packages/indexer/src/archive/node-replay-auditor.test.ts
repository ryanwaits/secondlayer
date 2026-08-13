import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type BlockCheck,
	type NodeAttestation,
	emptyAuditBuckets,
	recordAuditOutcome,
	writeNodeAttestation,
} from "./node-replay-auditor.ts";

/**
 * These tests exercise the audit report shape end-to-end (write path). A
 * full-fidelity node + DB integration is covered by the CLI entrypoint
 * against staging — running it here would require both a live stacks-node
 * and a canonical DB seeded with known heights, which no CI environment
 * currently provides. Keeping a "DB smoke" here made the suite flake
 * whenever the DB didn't happen to hold the hard-coded height range.
 */

/**
 * The auditor's SQL uses the `sql` template tag which routes through kysely's
 * driver — mocking that from scratch is heavier than the value we get. This
 * test uses the write-artifact path directly to exercise the shape/signing
 * boundary, then a DB-backed smoke covers the walk.
 */
describe("writeNodeAttestation", () => {
	test("writes JSON at attestations/<snapshot>/node.json with pending fallback", async () => {
		const dir = await mkdtemp(join(tmpdir(), "node-audit-"));
		const withDigest: NodeAttestation = {
			schema_version: 1,
			kind: "node",
			network: "mainnet",
			snapshot_digest: "abc123",
			generated_at: "2026-01-01T00:00:00.000Z",
			node_url: "http://localhost:20443",
			coverage: { from_block: 0, to_block: 9 },
			attested_datasets: ["blocks"],
			unattested_datasets: [
				{ dataset: "transactions", reason: "no receipts on node" },
				{ dataset: "events", reason: "no events on node" },
			],
			stats: {
				blocks_checked: 10,
				matches: 10,
				mismatches: 0,
				node_unavailable: 0,
			},
			mismatches: [],
			unavailable: [],
			sample_matches: [],
		};
		const path = await writeNodeAttestation(dir, withDigest);
		expect(path).toEndWith("/attestations/abc123/node.json");
		const parsed = JSON.parse(await readFile(path, "utf8")) as NodeAttestation;
		expect(parsed.snapshot_digest).toBe("abc123");
		expect(parsed.attested_datasets).toEqual(["blocks"]);
	});

	test("falls back to pending/ when no snapshot digest is known", async () => {
		const dir = await mkdtemp(join(tmpdir(), "node-audit-"));
		const pending: NodeAttestation = {
			schema_version: 1,
			kind: "node",
			network: "mainnet",
			snapshot_digest: null,
			generated_at: "2026-01-01T00:00:00.000Z",
			node_url: "http://localhost:20443",
			coverage: { from_block: 0, to_block: 0 },
			attested_datasets: ["blocks"],
			unattested_datasets: [],
			stats: {
				blocks_checked: 0,
				matches: 0,
				mismatches: 0,
				node_unavailable: 0,
			},
			mismatches: [],
			unavailable: [],
			sample_matches: [],
		};
		const path = await writeNodeAttestation(dir, pending);
		expect(path).toEndWith("/attestations/pending/node.json");
	});
});

function mismatchAt(height: number): BlockCheck {
	return {
		height,
		status: "mismatch",
		expected_hash: "aa",
		actual_hash: "bb",
		expected_index_block_hash: "cc",
		actual_index_block_hash: "dd",
		mismatches: ["hash"],
	};
}

function unavailableAt(height: number): BlockCheck {
	return {
		height,
		status: "node-unavailable",
		expected_hash: "aa",
		expected_index_block_hash: "cc",
		reason: "timeout",
	};
}

function matchAt(height: number): BlockCheck {
	return {
		height,
		status: "match",
		expected_hash: "aa",
		actual_hash: "aa",
		expected_index_block_hash: "cc",
		actual_index_block_hash: "cc",
	};
}

describe("recordAuditOutcome", () => {
	test("stats keep counting after the mismatch list hits the cap", () => {
		const buckets = emptyAuditBuckets();
		for (let height = 1; height <= 250; height++) {
			recordAuditOutcome(buckets, mismatchAt(height), 200, 5);
		}
		expect(buckets.mismatchCount).toBe(250);
		expect(buckets.mismatches).toHaveLength(200);
		expect(buckets.mismatches[0]?.height).toBe(1);
		expect(buckets.mismatches[199]?.height).toBe(200);
		expect(buckets.matches).toBe(0);
		expect(buckets.unavailableCount).toBe(0);
	});

	test("stats keep counting after the unavailable list hits the cap", () => {
		const buckets = emptyAuditBuckets();
		for (let height = 1; height <= 210; height++) {
			recordAuditOutcome(buckets, unavailableAt(height), 200, 5);
		}
		expect(buckets.unavailableCount).toBe(210);
		expect(buckets.unavailable).toHaveLength(200);
		expect(buckets.unavailable[0]?.height).toBe(1);
		expect(buckets.unavailable[199]?.height).toBe(200);
	});

	test("sample_matches stays bounded while the match counter is exact", () => {
		const buckets = emptyAuditBuckets();
		for (let height = 1; height <= 12; height++) {
			recordAuditOutcome(buckets, matchAt(height), 200, 5);
		}
		expect(buckets.matches).toBe(12);
		expect(buckets.sampleMatches).toHaveLength(5);
		expect(buckets.sampleMatches.map((row) => row.height)).toEqual([
			1, 2, 3, 4, 5,
		]);
	});
});
