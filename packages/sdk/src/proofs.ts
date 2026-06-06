import {
	type RewardSet,
	verifySignerSignatures,
} from "@secondlayer/shared/node/consensus";
import {
	type MerkleProofStep,
	nakamotoBlockHash,
	nakamotoBlockId,
	parseNakamotoBlockHeader,
	stacksTxid,
	verifyTxMerkleProof,
} from "@secondlayer/shared/node/nakamoto";

/**
 * Trustless transaction-inclusion proof verification (Anchored level).
 *
 * Given a proof from `GET /v1/index/transactions/:txid/proof`, the consumer
 * re-derives everything itself — it does NOT trust any value Secondlayer
 * computed. It (1) recomputes the txid from the raw tx bytes, (2) folds it up
 * the merkle path to the header's `tx_merkle_root`, and (3) recomputes the
 * header's `block_hash` and `index_block_hash` from the raw header. The result
 * is "this tx is included in a header any node can corroborate" — one rung short
 * of consensus-verified (which adds the signer-set signatures, future phase).
 *
 * Note: uses Node's crypto via `@secondlayer/shared` (same as the Streams
 * signature verify); intended for Node/server verification.
 */
export interface TransactionProof {
	txid: string;
	index_block_hash: string;
	block_height: number;
	tx_index: number;
	/** Raw consensus-serialized transaction bytes (hex). */
	raw_tx: string;
	/** Raw Nakamoto block-header bytes (hex) — parsed + re-hashed by the verifier. */
	raw_header: string;
	/** Authentication path from the tx leaf to `tx_merkle_root`. */
	tx_merkle_path: MerkleProofStep[];
	/** Present when consensus-level verification is available: the reward cycle and
	 *  its signer set, against which the header's signer signatures are checked. */
	consensus?: {
		reward_cycle: number;
		reward_set: RewardSet;
	};
}

export interface TransactionProofVerifyResult {
	/** Highest level actually verified. "consensus" requires the proof's
	 *  `consensus` field and a met signer-weight threshold. */
	level: "anchored" | "consensus";
	/** Recomputed txid === proof.txid. */
	txidMatches: boolean;
	/** Merkle path folds the txid to the header's tx_merkle_root. */
	includedInHeader: boolean;
	/** Recomputed block_hash + index_block_hash match the header / proof. */
	headerSelfConsistent: boolean;
	/** Basis points (0–10000) of reward-set signer weight that signed the block.
	 *  Only set when the proof carries a `consensus` field. */
	signerWeightBps?: number;
	/** ≥70% of signer weight signed. Only set with a `consensus` field. */
	thresholdMet?: boolean;
	/** All applicable checks passed (incl. the threshold when consensus is present). */
	ok: boolean;
	errors: string[];
}

const strip = (h: string): string => (h.startsWith("0x") ? h.slice(2) : h);
const bytes = (h: string): Uint8Array =>
	Uint8Array.from(Buffer.from(strip(h), "hex"));

/**
 * Verify an Anchored transaction-inclusion proof. Every check is recomputed
 * client-side, so a `true` result does not rely on trusting Secondlayer.
 */
export function verifyTransactionProof(
	proof: TransactionProof,
): TransactionProofVerifyResult {
	const errors: string[] = [];

	// (1) recompute the txid from the raw tx bytes
	const computedTxid = stacksTxid(bytes(proof.raw_tx));
	const txidMatches = computedTxid === strip(proof.txid);
	if (!txidMatches) errors.push("txid does not match raw_tx");

	// parse the header (so we use ITS tx_merkle_root / consensus_hash, not a field)
	const header = parseNakamotoBlockHeader(bytes(proof.raw_header));

	// (2) inclusion: fold txid up the merkle path to the header's root
	const includedInHeader = verifyTxMerkleProof(
		computedTxid,
		proof.tx_merkle_path,
		header.txMerkleRoot,
	);
	if (!includedInHeader)
		errors.push("merkle path does not reach tx_merkle_root");

	// (3) header self-consistency: recompute block_hash + index_block_hash
	const blockHash = nakamotoBlockHash(header);
	const indexBlockHash = nakamotoBlockId(blockHash, header.consensusHash);
	const headerSelfConsistent = indexBlockHash === strip(proof.index_block_hash);
	if (!headerSelfConsistent) {
		errors.push("recomputed index_block_hash does not match proof");
	}

	const anchoredOk = txidMatches && includedInHeader && headerSelfConsistent;

	// (4) consensus: recover the header's signer signatures over the block_hash and
	// weigh them against the reward set. Trustless if `reward_set` was independently
	// resolved by the caller (or re-checkable against /v3/stacker_set).
	let level: "anchored" | "consensus" = "anchored";
	let signerWeightBps: number | undefined;
	let thresholdMet: boolean | undefined;
	if (proof.consensus) {
		const v = verifySignerSignatures(
			blockHash,
			header.signerSignatures,
			proof.consensus.reward_set,
		);
		signerWeightBps =
			v.totalWeight > 0
				? Math.round((v.signedWeight / v.totalWeight) * 10000)
				: 0;
		thresholdMet = v.thresholdMet;
		if (!thresholdMet) errors.push("signer weight below the 70% threshold");
		if (anchoredOk && thresholdMet) level = "consensus";
	}

	return {
		level,
		txidMatches,
		includedInHeader,
		headerSelfConsistent,
		signerWeightBps,
		thresholdMet,
		ok: anchoredOk && (proof.consensus ? thresholdMet === true : true),
		errors,
	};
}
