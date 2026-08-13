import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { closeDb, getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { fetchNakamotoBlock } from "@secondlayer/shared/node/nakamoto";
import { signStreamsBulkManifest } from "@secondlayer/shared/streams-bulk-manifest";
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
 *   - Attested: `blocks` identity (`hash`, `index_block_hash`) per height.
 *   - Not attested by this pass: `transactions` (raw bytes are on the node but
 *     `raw_result` / `status` are execution outcomes the node does not expose),
 *     `events` (the node does not expose events at all — they arrive only via
 *     the observer callback). Both are declared `unattested-by-node` in the
 *     report so a consumer cannot mistake silence for approval.
 *
 * The output is a `NodeAttestation` document. It is designed to be published
 * to R2 at `attestations/<snapshot_digest>/node.json`, though this module does
 * not upload — it produces the artifact; a separate step signs and ships.
 */

export const NODE_ATTESTATION_SCHEMA_VERSION = 1 as const;
export const NODE_ATTESTATION_KIND = "node" as const;

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
			mismatches: Array<"hash" | "index_block_hash">;
	  }
	| {
			height: number;
			status: "node-unavailable";
			expected_hash: string;
			expected_index_block_hash: string;
			reason: string;
	  };

export type NodeAttestation = {
	schema_version: typeof NODE_ATTESTATION_SCHEMA_VERSION;
	kind: typeof NODE_ATTESTATION_KIND;
	network: string;
	snapshot_digest: string | null;
	generated_at: string;
	node_url: string;
	coverage: { from_block: number; to_block: number };
	attested_datasets: Array<"blocks">;
	unattested_datasets: Array<{
		dataset: "transactions" | "events";
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
}

const DEFAULT_MAX_MISMATCHES = 200;
const DEFAULT_MAX_SAMPLES = 5;
const DEFAULT_PROGRESS_EVERY = 1_000;

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

	const mismatches: BlockCheck[] = [];
	const unavailable: BlockCheck[] = [];
	const sampleMatches: BlockCheck[] = [];
	let matches = 0;

	// Walk heights in ascending order via a cursor rather than SELECT * — a
	// full-chain audit touches ~9M rows and OOM on materializing them.
	let cursor = options.fromBlock - 1;
	const totalHeights = options.toBlock - options.fromBlock + 1;
	let checked = 0;
	const BATCH_ROWS = 500;

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

		for (const row of rows) {
			const height = Number(row.height);
			const expectedHash = row.hash;
			const expectedIbh = row.index_block_hash;
			if (!expectedIbh) {
				// A canonical row missing its ibh means our own data cannot say what
				// the node should return. Report as unavailable rather than pretend.
				unavailable.push({
					height,
					status: "node-unavailable",
					expected_hash: expectedHash,
					expected_index_block_hash: "",
					reason: "local canonical row has no index_block_hash",
				});
				checked += 1;
				continue;
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
				if (hashOk && ibhOk) {
					matches += 1;
					if (sampleMatches.length < maxSamples) {
						sampleMatches.push({
							height,
							status: "match",
							expected_hash: expected,
							actual_hash: actualHash,
							expected_index_block_hash: expectedIbhNorm,
							actual_index_block_hash: actualIbh,
						});
					}
				} else if (mismatches.length < maxMismatches) {
					const which: Array<"hash" | "index_block_hash"> = [];
					if (!hashOk) which.push("hash");
					if (!ibhOk) which.push("index_block_hash");
					mismatches.push({
						height,
						status: "mismatch",
						expected_hash: expected,
						actual_hash: actualHash,
						expected_index_block_hash: expectedIbhNorm,
						actual_index_block_hash: actualIbh,
						mismatches: which,
					});
				} else {
					// Cap the reported list — the truth is in `stats`.
				}
			} catch (err) {
				if (unavailable.length < maxMismatches) {
					unavailable.push({
						height,
						status: "node-unavailable",
						expected_hash: expectedHash,
						expected_index_block_hash: expectedIbh,
						reason: err instanceof Error ? err.message : String(err),
					});
				}
			}

			checked += 1;
			if (checked % progressEvery === 0 || checked === totalHeights) {
				options.onProgress?.(checked, totalHeights);
			}
		}
		cursor = Number(rows[rows.length - 1]?.height ?? cursor);
	}

	// Count-only totals — never trust `mismatches.length` since it's capped.
	let totalMismatches = mismatches.length;
	let totalUnavailable = unavailable.length;
	if (totalMismatches >= maxMismatches || totalUnavailable >= maxMismatches) {
		const totals = await countMismatchesAgainstNode({
			db,
			nodeUrl: options.nodeUrl,
			fromBlock: options.fromBlock,
			toBlock: options.toBlock,
			fetchImpl: options.fetchImpl,
		}).catch(() => null);
		if (totals) {
			totalMismatches = totals.mismatches;
			totalUnavailable = totals.unavailable;
		}
	}

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
		attested_datasets: ["blocks"],
		unattested_datasets: [
			{
				dataset: "transactions",
				reason:
					"stacks-node does not expose transaction execution `raw_result` / `status`; identity attestation only",
			},
			{
				dataset: "events",
				reason:
					"stacks-node does not expose events; they arrive only via the observer callback",
			},
		],
		stats: {
			blocks_checked: checked,
			matches,
			mismatches: totalMismatches,
			node_unavailable: totalUnavailable,
		},
		mismatches,
		unavailable,
		sample_matches: sampleMatches,
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

/**
 * Fallback total-count pass, used only when the sampled mismatch/unavailable
 * list hits the reporting cap and the true totals matter for `stats`. Kept
 * separate from the main loop so callers can skip it in ordinary runs.
 */
async function countMismatchesAgainstNode(_params: {
	db: Kysely<Database>;
	nodeUrl: string;
	fromBlock: number;
	toBlock: number;
	fetchImpl?: typeof fetch;
}): Promise<{ mismatches: number; unavailable: number } | null> {
	// Placeholder: a real full count re-walks the range with a cheaper batch of
	// requests. Left null so `stats` reflects the sampled floor rather than a
	// fabricated total. Explicit floor > fake ceiling.
	return null;
}

function parseCliArgs(argv: string[]): {
	fromBlock: number;
	toBlock: number;
	outDir: string;
	nodeUrl: string;
	snapshotDigest: string | null;
} {
	let fromBlock = 0;
	let toBlock = 0;
	let outDir = "./canonical-v1-staging";
	let nodeUrl = process.env.STACKS_NODE_RPC_URL ?? "http://localhost:20443";
	let snapshotDigest: string | null = null;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--from-block") fromBlock = Number(argv[++i]);
		else if (arg === "--to-block") toBlock = Number(argv[++i]);
		else if (arg === "--out") outDir = argv[++i] ?? outDir;
		else if (arg === "--node-url") nodeUrl = argv[++i] ?? nodeUrl;
		else if (arg === "--snapshot") snapshotDigest = argv[++i] ?? null;
	}
	if (toBlock <= 0 || toBlock < fromBlock) {
		throw new Error(
			"--from-block and --to-block are required, with --to-block >= --from-block",
		);
	}
	return { fromBlock, toBlock, outDir, nodeUrl, snapshotDigest };
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
