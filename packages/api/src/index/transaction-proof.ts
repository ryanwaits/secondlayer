import { getSourceDb, sql } from "@secondlayer/shared/db";
import { StacksNodeClient } from "@secondlayer/shared/node";
import {
	type RewardSet,
	rewardCycle,
} from "@secondlayer/shared/node/consensus";
import {
	type MerkleProofStep,
	txMerkleProof,
	txMerkleRoot,
} from "@secondlayer/shared/node/nakamoto";

/**
 * Transaction-inclusion proof.
 *
 * `GET /v1/index/transactions/:tx_id/proof` returns the data a consumer needs to
 * verify — without trusting us — that a transaction is included in a Nakamoto
 * block header that any node can corroborate: the raw tx (to recompute the
 * txid), the raw block header (to recompute block_hash / index_block_hash), and
 * the tx-merkle authentication path. When the block's reward set is available it
 * also carries `consensus` (the cycle + signer set) so a client can additionally
 * verify the signer signatures cross the 70% weight threshold. The SDK's
 * `verifyTransactionProof` re-runs all of it.
 */
const strip = (h: string): string => (h.startsWith("0x") ? h.slice(2) : h);

export interface TransactionProofResponse {
	txid: string;
	index_block_hash: string;
	block_height: number;
	tx_index: number;
	raw_tx: string;
	raw_header: string;
	tx_merkle_path: MerkleProofStep[];
	/** Reward cycle + signer set, present when the reward set could be resolved. */
	consensus?: { reward_cycle: number; reward_set: RewardSet };
}

/**
 * Pure assembler: given the tx, the full ordered set of block txids, the raw
 * header, and the block id, produce the proof. Kept pure so it's testable
 * without a DB/node. NOTE: `orderedBlockTxids` MUST be the block's complete tx
 * set in block order — if it's wrong, the proof simply fails to verify
 * client-side (fail-safe), it never produces a falsely-valid proof.
 */
export function buildTransactionProof(params: {
	txId: string;
	rawTxHex: string;
	txIndex: number;
	orderedBlockTxids: string[];
	rawHeaderHex: string;
	indexBlockHash: string;
	blockHeight: number;
}): TransactionProofResponse {
	return {
		txid: strip(params.txId),
		index_block_hash: strip(params.indexBlockHash),
		block_height: params.blockHeight,
		tx_index: params.txIndex,
		raw_tx: strip(params.rawTxHex),
		raw_header: params.rawHeaderHex,
		tx_merkle_path: txMerkleProof(
			params.orderedBlockTxids.map(strip),
			params.txIndex,
		),
	};
}

export type ProofTxReader = (txId: string) => Promise<{
	block_height: number;
	tx_index: number;
	raw_tx: string;
	burn_block_height: number;
	/** Persisted block id; null on rows ingested before it was stored. */
	index_block_hash?: string | null;
} | null>;

/** Ordered canonical txids of a block (must match the block's tx set). */
export type BlockTxidsReader = (blockHeight: number) => Promise<string[]>;

export interface ProofNodeClient {
	getBlock(height: number): Promise<{ index_block_hash: string } | null>;
	getNakamotoBlock(blockId: string): Promise<{
		raw: Uint8Array;
		header: { headerByteLength: number; txMerkleRoot: string };
	} | null>;
	getRewardSet(cycle: number): Promise<RewardSet | null>;
}

/** Returned when our stored tx set doesn't reproduce the block's committed
 *  tx_merkle_root — we refuse to emit a proof we can't guarantee verifies. */
export class IncompleteBlockTxSetError extends Error {
	constructor(blockHeight: number) {
		super(
			`stored tx set does not reproduce tx_merkle_root for block ${blockHeight}`,
		);
		this.name = "IncompleteBlockTxSetError";
	}
}

/**
 * Gather the proof pieces from our DB + the stacks-node and assemble. Returns
 * null when the tx or its block can't be found. Readers are injected so the
 * route can supply defaults and tests can supply fakes.
 */
export async function getTransactionProof(opts: {
	txId: string;
	readTx: ProofTxReader;
	readBlockTxids: BlockTxidsReader;
	node: ProofNodeClient;
}): Promise<TransactionProofResponse | null> {
	const tx = await opts.readTx(opts.txId);
	if (!tx) return null;
	// Prefer the persisted index_block_hash; fall back to a node lookup by height
	// for rows ingested before it was stored.
	const indexBlockHash =
		tx.index_block_hash ??
		(await opts.node.getBlock(tx.block_height))?.index_block_hash ??
		null;
	if (!indexBlockHash) return null;
	const nb = await opts.node.getNakamotoBlock(indexBlockHash);
	if (!nb) return null;
	const orderedTxids = await opts.readBlockTxids(tx.block_height);
	// Completeness guard: only emit a proof if OUR ordered tx set reproduces the
	// block's own tx_merkle_root. This guarantees the path verifies client-side
	// and turns a missing/extra tx (e.g. coinbase) into an explicit error instead
	// of a silently-unverifiable proof.
	if (txMerkleRoot(orderedTxids.map(strip)) !== nb.header.txMerkleRoot) {
		throw new IncompleteBlockTxSetError(tx.block_height);
	}
	const rawHeaderHex = Buffer.from(
		nb.raw.subarray(0, nb.header.headerByteLength),
	).toString("hex");
	const proof = buildTransactionProof({
		txId: opts.txId,
		rawTxHex: tx.raw_tx,
		txIndex: tx.tx_index,
		orderedBlockTxids: orderedTxids,
		rawHeaderHex,
		indexBlockHash,
		blockHeight: tx.block_height,
	});
	// Best-effort consensus layer: attach the cycle's reward set so a client can
	// also verify the signer signatures. Omitted (anchored-only proof) if the set
	// can't be resolved.
	const cycle = rewardCycle(tx.burn_block_height);
	const rewardSet = await opts.node.getRewardSet(cycle).catch(() => null);
	if (rewardSet) {
		proof.consensus = { reward_cycle: cycle, reward_set: rewardSet };
	}
	return proof;
}

// ── Default readers (chain data on the source DB; canonicity via blocks join) ──

const defaultProofTxReader: ProofTxReader = async (txId) => {
	const { rows } = await sql<{
		block_height: number;
		tx_index: number;
		raw_tx: string;
		burn_block_height: number;
		index_block_hash: string | null;
	}>`
		SELECT t.block_height, t.tx_index, t.raw_tx, b.burn_block_height, b.index_block_hash
		FROM transactions t
		JOIN blocks b ON b.height = t.block_height AND b.canonical = true
		WHERE t.tx_id = ${txId}
		LIMIT 1
	`.execute(getSourceDb());
	return rows.at(0) ?? null;
};

const defaultBlockTxidsReader: BlockTxidsReader = async (height) => {
	const { rows } = await sql<{ tx_id: string }>`
		SELECT t.tx_id
		FROM transactions t
		WHERE t.block_height = ${height}
			AND EXISTS (
				SELECT 1 FROM blocks b
				WHERE b.height = t.block_height AND b.canonical = true
			)
		ORDER BY t.tx_index ASC
	`.execute(getSourceDb());
	return rows.map((r) => r.tx_id);
};

/**
 * Default proof gatherer wired to the source DB + a stacks-node. Needs
 * `STACKS_NODE_RPC_URL` reachable from the api container (the proof endpoint
 * fetches the signed block header from `/v3/blocks`).
 */
export function getTransactionProofDefault(
	txId: string,
): Promise<TransactionProofResponse | null> {
	return getTransactionProof({
		txId,
		readTx: defaultProofTxReader,
		readBlockTxids: defaultBlockTxidsReader,
		node: new StacksNodeClient(),
	});
}
