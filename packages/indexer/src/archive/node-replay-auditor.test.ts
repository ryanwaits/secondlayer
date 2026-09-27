import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { txMerkleRoot } from "@secondlayer/shared/node/nakamoto";
import {
	type AttestableTx,
	type BlockCheck,
	type NodeAttestation,
	attestedTxIds,
	checkTxMerkleRoot,
	emptyAuditBuckets,
	isObserverSyntheticBootTx,
	recordAuditOutcome,
	writeNodeAttestation,
} from "./node-replay-auditor.ts";

const BOOT_ADDRESS = "SP000000000000000000002Q6VF78";
/** A 32-byte hex txid filled with `n`, for merkle-root fixtures. */
const txid = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const TX_A = txid(0xa);
const TX_B = txid(0xb);
const TX_BOOT = txid(0xf);

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
			attested_datasets: ["blocks", "transactions"],
			unattested_datasets: [{ dataset: "events", reason: "no events on node" }],
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
		expect(parsed.attested_datasets).toEqual(["blocks", "transactions"]);
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

describe("isObserverSyntheticBootTx", () => {
	test("flags a smart_contract deploy from the mainnet boot address", () => {
		expect(
			isObserverSyntheticBootTx(
				{ sender: BOOT_ADDRESS, type: "smart_contract" },
				"mainnet",
			),
		).toBe(true);
	});

	test("does not flag a real user's smart_contract deploy", () => {
		expect(
			isObserverSyntheticBootTx(
				{ sender: "SP1ABC", type: "smart_contract" },
				"mainnet",
			),
		).toBe(false);
	});

	test("does not flag a non-deploy tx even from the boot address", () => {
		expect(
			isObserverSyntheticBootTx(
				{ sender: BOOT_ADDRESS, type: "contract_call" },
				"mainnet",
			),
		).toBe(false);
	});
});

describe("checkTxMerkleRoot", () => {
	function tx(
		id: string,
		index: number,
		opts?: Partial<AttestableTx>,
	): AttestableTx {
		return {
			tx_id: id,
			tx_index: index,
			sender: "SP1ABC",
			type: "token_transfer",
			...opts,
		};
	}

	test("attests a complete block", () => {
		const txs = [tx(TX_A, 0), tx(TX_B, 1)];
		const nodeRoot = txMerkleRoot([TX_A, TX_B]);
		expect(checkTxMerkleRoot(txs, "mainnet", nodeRoot)).toEqual({
			status: "match",
			computedRoot: nodeRoot.startsWith("0x") ? nodeRoot.slice(2) : nodeRoot,
		});
	});

	test("a missing txid yields a merkle mismatch", () => {
		const nodeRoot = txMerkleRoot([TX_A, TX_B]);
		// We only hold TX_A — TX_B silently went missing.
		const result = checkTxMerkleRoot([tx(TX_A, 0)], "mainnet", nodeRoot);
		expect(result.status).toBe("mismatch");
	});

	test("excludes an observer-synthetic boot-deploy tx so a complete block still attests", () => {
		// The node's raw block (and its real tx_merkle_root) never included the
		// boot deploy — exactly the pox-5-at-8,665,568 shape (DB 3 vs node 2).
		const nodeRoot = txMerkleRoot([TX_A, TX_B]);
		const txs = [
			tx(TX_A, 0),
			tx(TX_B, 1),
			tx(TX_BOOT, 2, { sender: BOOT_ADDRESS, type: "smart_contract" }),
		];
		expect(attestedTxIds(txs, "mainnet")).toEqual([TX_A, TX_B]);
		expect(checkTxMerkleRoot(txs, "mainnet", nodeRoot).status).toBe("match");
	});

	test("a block with no attestable txs is a mismatch, not an empty pass", () => {
		const nodeRoot = txMerkleRoot([TX_A]);
		expect(checkTxMerkleRoot([], "mainnet", nodeRoot)).toEqual({
			status: "mismatch",
			computedRoot: null,
		});
	});
});
