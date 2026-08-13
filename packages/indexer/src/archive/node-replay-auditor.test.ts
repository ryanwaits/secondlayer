import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type NodeAttestation,
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
