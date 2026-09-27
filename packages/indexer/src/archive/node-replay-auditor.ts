import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { closeDb, getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import {
	fetchNakamotoBlock,
	txMerkleRoot,
} from "@secondlayer/shared/node/nakamoto";
import { signStreamsBulkManifest } from "@secondlayer/shared/streams-bulk-manifest";
import { devnet, mainnet, mocknet, testnet } from "@secondlayer/stacks/chains";
import type { Kysely } from "kysely";
import { writeJsonFile } from "../streams-bulk/file.ts";

/**
 * Node replay auditor — the first independent check on the archive.
 *
 * The archive's per-partition semantic-v1 digest proves the exporter produced
 * consistent bytes from one database snapshot. It does NOT prove that database
 * observed the same chain any other operator sees. This module answers the
 * question the archive alone cannot: "does an independently-run stacks-node
 * agree with the identities we published?"
 *
 * For each canonical height in a bounded range, the auditor:
 *   1. Reads the archive's canonical `hash` and `index_block_hash` at that
 *      height (from our own DB; the archive was built from this DB).
 *   2. Fetches the raw Nakamoto block from a stacks-node via
 *      `/v3/blocks/{index_block_hash}`.
 *   3. Recomputes `block_hash` and `index_block_hash` from the raw bytes
 *      (SHA512/256 over the signer-signature-omitted preimage).
 *   4. Records a match, mismatch, or unavailable per height.
 *
 * Scope — what this attests, honestly:
 *   - Attested: `blocks` identity (`hash`, `index_block_hash`) per height, and
 *     `transactions` identity + membership — recomputing `txMerkleRoot` over
 *     our stored txids (ordered by `tx_index`) and comparing it against the
 *     node header's `tx_merkle_root` proves every txid we hold for a height
 *     is one the node actually included there, and none is missing. It does
 *     NOT attest execution: `raw_result` / `status` are outcomes the node
 *     does not expose.
 *   - Not attested by this pass: `events` (the node does not expose events at
 *     all — they arrive only via the observer callback). Declared
 *     `unattested-by-node` in the report so a consumer cannot mistake silence
 *     for approval.
 *
 * The output is a `NodeAttestation` document. It is designed to be published
 * to R2 at `attestations/<snapshot_digest>/node.json`, though this module does
 * not upload — it produces the artifact; a separate step signs and ships.
 */

export const NODE_ATTESTATION_SCHEMA_VERSION = 1 as const;
export const NODE_ATTESTATION_KIND = "node" as const;

export type BlockCheckMismatchField =
	| "hash"
	| "index_block_hash"
	| "tx_merkle_root";

export type BlockCheck =
	| {
			height: number;
			status: "match";
			expected_hash: string;
			actual_hash: string;
			expected_index_block_hash: string;
			actual_index_block_hash: string;
	  }
	| {
			height: number;
			status: "mismatch";
			expected_hash: string;
			actual_hash: string;
			expected_index_block_hash: string;
			actual_index_block_hash: string;
			mismatches: BlockCheckMismatchField[];
	  }
	| {
			height: number;
			status: "node-unavailable";
			expected_hash: string;
			expected_index_block_hash: string;
			reason: string;
	  };

/** Boot address per network — the deployer of every boot contract (pox-2..5,
 *  costs-*, bns, …). Only the node itself can act as this sender: it has no
 *  private key, so no real user transaction can ever name it. */
function bootAddressForNetwork(network: string): string {
	switch (network) {
		case "testnet":
			return testnet.bootAddress;
		case "devnet":
			return devnet.bootAddress;
		case "mocknet":
			return mocknet.bootAddress;
		default:
			return mainnet.bootAddress;
	}
}

export type AttestableTx = {
	tx_id: string;
	tx_index: number;
	sender: string;
	type: string;
};

/**
 * A transaction the observer synthesizes for a boot-contract deploy at a
 * hard-fork activation (e.g. pox-5 at Epoch 4.0, block 8,665,568) is never in
 * the node's own raw block bytes — it isn't a broadcast transaction, so it
 * carries no place in the consensus tx merkle tree. We store it anyway (it's
 * real chain state), but a byte-for-byte replay of the node's header must
 * exclude it or it will "mismatch" a block that is actually complete.
 *
 * Identified by sender: only the chain's boot address can appear as a
 * `smart_contract` deployer here, and only the node — never a keyed user
 * transaction — can produce that.
 */
export function isObserverSyntheticBootTx(
	tx: Pick<AttestableTx, "sender" | "type">,
	network: string,
): boolean {
	return (
		tx.type === "smart_contract" && tx.sender === bootAddressForNetwork(network)
	);
}

/** Our stored txids for a height, in consensus tx-merkle order, with
 *  observer-synthetic boot-deploy txs excluded (see {@link isObserverSyntheticBootTx}). */
export function attestedTxIds(txs: AttestableTx[], network: string): string[] {
	return txs
		.filter((tx) => !isObserverSyntheticBootTx(tx, network))
		.sort((a, b) => a.tx_index - b.tx_index)
		.map((tx) => tx.tx_id);
}

export type TxMerkleCheck =
	| { status: "match"; computedRoot: string }
	| { status: "mismatch"; computedRoot: string | null };

/**
 * Recompute `txMerkleRoot` over our stored txids for a height (boot-synthetic
 * txs excluded) and compare it against the node header's own root. `null`
 * `computedRoot` means we hold no attestable txs at all for the height — a
 * complete block always has at least a coinbase, so that is itself a mismatch,
 * not a special case.
 */
export function checkTxMerkleRoot(
	txs: AttestableTx[],
	network: string,
	nodeTxMerkleRootHex: string,
): TxMerkleCheck {
	const ids = attestedTxIds(txs, network);
	if (ids.length === 0) {
		return { status: "mismatch", computedRoot: null };
	}
	const computedRoot = normalizeHash(txMerkleRoot(ids));
	const expected = normalizeHash(nodeTxMerkleRootHex);
	return computedRoot === expected
		? { status: "match", computedRoot }
		: { status: "mismatch", computedRoot };
}

export type NodeAttestation = {
	schema_version: typeof NODE_ATTESTATION_SCHEMA_VERSION;
	kind: typeof NODE_ATTESTATION_KIND;
	network: string;
	snapshot_digest: string | null;
	generated_at: string;
	node_url: string;
	coverage: { from_block: number; to_block: number };
	attested_datasets: Array<"blocks" | "transactions">;
	unattested_datasets: Array<{
		dataset: "events";
		reason: string;
	}>;
	stats: {
		blocks_checked: number;
		matches: number;
		mismatches: number;
		node_unavailable: number;
	};
	mismatches: BlockCheck[];
	unavailable: BlockCheck[];
	sample_matches: BlockCheck[];
	signature?: string;
	key_id?: string;
};

export interface NodeReplayAuditOptions {
	network: string;
	nodeUrl: string;
	fromBlock: number;
	toBlock: number;
	snapshotDigest?: string | null;
	/** Cap the mismatch list to keep the report bounded on catastrophic drift.
	 *  Every mismatch is still counted in `stats`. */
	maxMismatchesReported?: number;
	/** Report at most this many successful checks as evidence (default 5). */
	maxSampleMatches?: number;
	generatedAt?: string;
	db?: Kysely<Database>;
	fetchImpl?: typeof fetch;
	signingPrivateKeyPem?: string;
	/** Log progress every N heights. */
	progressEvery?: number;
	onProgress?: (checked: number, total: number) => void;
	/**
	 * Max in-flight `/v3/blocks/{ibh}` fetches at any moment. Sequential (1)
	 * bounds a full-chain audit at days; 8 cuts that to hours. Every request
	 * is a read of an immutable file the node already has on disk, so the
	 * node handles this fine — but a hosted stacks-node under other load
	 * may want a lower value. Ordering of `sample_matches` is preserved
	 * regardless.
	 */
	concurrency?: number;
}

const DEFAULT_MAX_MISMATCHES = 200;
const DEFAULT_MAX_SAMPLES = 5;
const DEFAULT_PROGRESS_EVERY = 1_000;
const DEFAULT_CONCURRENCY = 8;

/** Exact counters plus capped evidence lists for one audit run. */
export type AuditOutcomeBuckets = {
	matches: number;
	mismatchCount: number;
	unavailableCount: number;
	mismatches: BlockCheck[];
	unavailable: BlockCheck[];
	sampleMatches: BlockCheck[];
};

export function emptyAuditBuckets(): AuditOutcomeBuckets {
	return {
		matches: 0,
		mismatchCount: 0,
		unavailableCount: 0,
		mismatches: [],
		unavailable: [],
		sampleMatches: [],
	};
}

/**
 * Record one height. Lists stay capped so a catastrophic run cannot emit a
 * gigabyte of JSON; counters stay exact so `stats` cannot lie by omission.
 */
export function recordAuditOutcome(
	buckets: AuditOutcomeBuckets,
	result: BlockCheck,
	maxMismatches: number,
	maxSamples: number,
): void {
	if (result.status === "match") {
		buckets.matches += 1;
		if (buckets.sampleMatches.length < maxSamples) {
			buckets.sampleMatches.push(result);
		}
		return;
	}
	if (result.status === "mismatch") {
		buckets.mismatchCount += 1;
		if (buckets.mismatches.length < maxMismatches) {
			buckets.mismatches.push(result);
		}
		return;
	}
	buckets.unavailableCount += 1;
	if (buckets.unavailable.length < maxMismatches) {
		buckets.unavailable.push(result);
	}
}

/**
 * Compare the local canonical index at [fromBlock, toBlock] against a
 * stacks-node's block identities. Returns the attestation document.
 */
export async function runNodeReplayAudit(
	options: NodeReplayAuditOptions,
): Promise<NodeAttestation> {
	const db = options.db ?? getSourceDb();
	const maxMismatches = options.maxMismatchesReported ?? DEFAULT_MAX_MISMATCHES;
	const maxSamples = options.maxSampleMatches ?? DEFAULT_MAX_SAMPLES;
	const progressEvery = options.progressEvery ?? DEFAULT_PROGRESS_EVERY;
	const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);

	const buckets = emptyAuditBuckets();

	// Walk heights in ascending order via a cursor rather than SELECT * — a
	// full-chain audit touches ~9M rows and OOM on materializing them.
	let cursor = options.fromBlock - 1;
	const totalHeights = options.toBlock - options.fromBlock + 1;
	let checked = 0;
	const BATCH_ROWS = 500;

	// Per-row check: no shared mutable state, safe to run concurrently. Returns
	// a `BlockCheck` describing what we found for that height. The caller
	// merges into the outer accumulators in height-ascending order so the
	// bounded `sample_matches`, `mismatches`, and `unavailable` lists stay
	// deterministic regardless of network completion order.
	const checkOne = async (row: {
		height: number;
		expectedHash: string;
		expectedIbh: string | null;
		txs: AttestableTx[];
	}): Promise<BlockCheck> => {
		const { height, expectedHash, expectedIbh, txs } = row;
		if (!expectedIbh) {
			return {
				height,
				status: "node-unavailable",
				expected_hash: expectedHash,
				expected_index_block_hash: "",
				reason: "local canonical row has no index_block_hash",
			};
		}
		try {
			const fetched = await fetchNakamotoBlock({
				nodeUrl: options.nodeUrl,
				blockId: expectedIbh,
				fetchImpl: options.fetchImpl,
			});
			const actualHash = normalizeHash(fetched.blockHash);
			const actualIbh = normalizeHash(fetched.indexBlockHash);
			const expected = normalizeHash(expectedHash);
			const expectedIbhNorm = normalizeHash(expectedIbh);
			const hashOk = actualHash === expected;
			const ibhOk = actualIbh === expectedIbhNorm;
			const txMerkle = checkTxMerkleRoot(
				txs,
				options.network,
				fetched.header.txMerkleRoot,
			);
			const txMerkleOk = txMerkle.status === "match";
			if (hashOk && ibhOk && txMerkleOk) {
				return {
					height,
					status: "match",
					expected_hash: expected,
					actual_hash: actualHash,
					expected_index_block_hash: expectedIbhNorm,
					actual_index_block_hash: actualIbh,
				};
			}
			const which: BlockCheckMismatchField[] = [];
			if (!hashOk) which.push("hash");
			if (!ibhOk) which.push("index_block_hash");
			if (!txMerkleOk) which.push("tx_merkle_root");
			return {
				height,
				status: "mismatch",
				expected_hash: expected,
				actual_hash: actualHash,
				expected_index_block_hash: expectedIbhNorm,
				actual_index_block_hash: actualIbh,
				mismatches: which,
			};
		} catch (err) {
			return {
				height,
				status: "node-unavailable",
				expected_hash: expectedHash,
				expected_index_block_hash: expectedIbh,
				reason: err instanceof Error ? err.message : String(err),
			};
		}
	};

	while (cursor < options.toBlock) {
		type Row = {
			height: string | number;
			hash: string;
			index_block_hash: string | null;
		};
		const { rows } = await sql<Row>`
			SELECT height, hash, index_block_hash
			  FROM blocks
			 WHERE canonical = true
			   AND height > ${cursor}
			   AND height <= ${options.toBlock}
			 ORDER BY height ASC
			 LIMIT ${BATCH_ROWS}
		`.execute(db);
		if (rows.length === 0) break;

		const heights = rows.map((row) => Number(row.height));
		type TxRow = {
			block_height: string | number;
			tx_id: string;
			tx_index: string | number;
			sender: string;
			type: string;
		};
		const { rows: txRows } = await sql<TxRow>`
			SELECT block_height, tx_id, tx_index, sender, type
			  FROM transactions
			 WHERE block_height = ANY(${heights})
		`.execute(db);
		const txsByHeight = new Map<number, AttestableTx[]>();
		for (const t of txRows) {
			const h = Number(t.block_height);
			const list = txsByHeight.get(h) ?? [];
			list.push({
				tx_id: t.tx_id,
				tx_index: Number(t.tx_index),
				sender: t.sender,
				type: t.type,
			});
			txsByHeight.set(h, list);
		}

		const normalized = rows.map((row) => ({
			height: Number(row.height),
			expectedHash: row.hash,
			expectedIbh: row.index_block_hash,
			txs: txsByHeight.get(Number(row.height)) ?? [],
		}));

		// Fire up to `concurrency` fetches at a time. `Promise.all` inside a
		// chunk preserves per-chunk input order in the resolved array, which is
		// how we keep `sample_matches` etc. deterministic across runs. The gap
		// between chunks is small so throughput ≈ concurrency × single-request.
		for (let i = 0; i < normalized.length; i += concurrency) {
			const chunk = normalized.slice(i, i + concurrency);
			const results = await Promise.all(chunk.map(checkOne));
			for (const result of results) {
				recordAuditOutcome(buckets, result, maxMismatches, maxSamples);
				checked += 1;
				if (checked % progressEvery === 0 || checked === totalHeights) {
					options.onProgress?.(checked, totalHeights);
				}
			}
		}
		cursor = Number(rows[rows.length - 1]?.height ?? cursor);
	}

	// Counters are exact; `mismatches[]` / `unavailable[]` are capped evidence.
	// Reporting `.length` of a capped list undercounted ~83k post-fork
	// mismatches as 200 on 2026-08-13.
	let doc: NodeAttestation = {
		schema_version: NODE_ATTESTATION_SCHEMA_VERSION,
		kind: NODE_ATTESTATION_KIND,
		network: options.network,
		snapshot_digest: options.snapshotDigest ?? null,
		generated_at: options.generatedAt ?? new Date().toISOString(),
		node_url: options.nodeUrl,
		coverage: {
			from_block: options.fromBlock,
			to_block: options.toBlock,
		},
		attested_datasets: ["blocks", "transactions"],
		unattested_datasets: [
			{
				dataset: "events",
				reason:
					"stacks-node does not expose events; they arrive only via the observer callback",
			},
		],
		stats: {
			blocks_checked: checked,
			matches: buckets.matches,
			mismatches: buckets.mismatchCount,
			node_unavailable: buckets.unavailableCount,
		},
		mismatches: buckets.mismatches,
		unavailable: buckets.unavailable,
		sample_matches: buckets.sampleMatches,
	};

	if (options.signingPrivateKeyPem) {
		doc = signStreamsBulkManifest(
			doc as unknown as Record<string, unknown>,
			options.signingPrivateKeyPem,
		) as unknown as NodeAttestation;
	}

	return doc;
}

/**
 * Write a node attestation to disk under `<outDir>/attestations/<snapshot>/node.json`
 * (or `pending/node.json` when no snapshot digest is known yet). Returns the
 * absolute path.
 */
export async function writeNodeAttestation(
	outDir: string,
	attestation: NodeAttestation,
): Promise<string> {
	const snapshotSlug = attestation.snapshot_digest ?? "pending";
	const path = `${outDir.replace(/\/+$/, "")}/attestations/${snapshotSlug}/node.json`;
	await mkdir(dirname(path), { recursive: true });
	await writeJsonFile(path, attestation);
	return path;
}

function normalizeHash(value: string): string {
	return (value.startsWith("0x") ? value.slice(2) : value).toLowerCase();
}

function parseCliArgs(argv: string[]): {
	fromBlock: number;
	toBlock: number;
	outDir: string;
	nodeUrl: string;
	snapshotDigest: string | null;
	concurrency: number;
} {
	let fromBlock = 0;
	let toBlock = 0;
	let outDir = "./canonical-v1-staging";
	let nodeUrl = process.env.STACKS_NODE_RPC_URL ?? "http://localhost:20443";
	let snapshotDigest: string | null = null;
	let concurrency = DEFAULT_CONCURRENCY;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--from-block") fromBlock = Number(argv[++i]);
		else if (arg === "--to-block") toBlock = Number(argv[++i]);
		else if (arg === "--out") outDir = argv[++i] ?? outDir;
		else if (arg === "--node-url") nodeUrl = argv[++i] ?? nodeUrl;
		else if (arg === "--snapshot") snapshotDigest = argv[++i] ?? null;
		else if (arg === "--concurrency") concurrency = Number(argv[++i]);
	}
	if (toBlock <= 0 || toBlock < fromBlock) {
		throw new Error(
			"--from-block and --to-block are required, with --to-block >= --from-block",
		);
	}
	if (!Number.isFinite(concurrency) || concurrency < 1) {
		throw new Error(
			`--concurrency must be a positive integer, got ${concurrency}`,
		);
	}
	return { fromBlock, toBlock, outDir, nodeUrl, snapshotDigest, concurrency };
}

async function main(): Promise<void> {
	const args = parseCliArgs(process.argv.slice(2));
	const network = process.env.STACKS_NETWORK ?? "mainnet";

	process.stderr.write(
		`node-audit: heights ${args.fromBlock}..${args.toBlock} against ${args.nodeUrl}\n`,
	);

	const attestation = await runNodeReplayAudit({
		network,
		nodeUrl: args.nodeUrl,
		fromBlock: args.fromBlock,
		toBlock: args.toBlock,
		snapshotDigest: args.snapshotDigest,
		concurrency: args.concurrency,
		signingPrivateKeyPem: process.env.STREAMS_SIGNING_PRIVATE_KEY,
		onProgress: (checked, total) => {
			process.stderr.write(`  ${checked}/${total} blocks checked\n`);
		},
	});

	const path = await writeNodeAttestation(args.outDir, attestation);

	process.stdout.write(
		`${JSON.stringify(
			{
				status:
					attestation.stats.mismatches === 0 &&
					attestation.stats.node_unavailable === 0
						? "clean"
						: "diverged",
				stats: attestation.stats,
				written: path,
			},
			null,
			2,
		)}\n`,
	);

	if (attestation.stats.mismatches > 0) {
		process.exitCode = 1;
	}
	await closeDb();
}

if (import.meta.main) {
	main().catch((err) => {
		process.stderr.write(
			`node-audit failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
		);
		process.exitCode = 2;
	});
}
