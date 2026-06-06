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
 * Trustless transaction-inclusion proof verification.
 *
 * Given a proof from `GET /v1/index/transactions/:txid/proof`, the consumer
 * re-derives everything itself — it does NOT trust any value Secondlayer
 * computed. Anchored level: (1) recompute the txid from the raw tx bytes, (2)
 * fold it up the merkle path to the header's `tx_merkle_root`, (3) recompute the
 * header's `block_hash` and `index_block_hash` from the raw header — "this tx is
 * included in a header any node can corroborate". Consensus level (when the proof
 * carries a `consensus` field, or a `rewardSet` is passed): additionally recover
 * the header's signer signatures and confirm ≥70% of reward-set signer weight
 * signed the block.
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
	/** Which reward set the signer check used: "provided" (caller-resolved →
	 *  fully trustless) or "embedded" (the one Secondlayer put in the proof). */
	rewardSetSource?: "provided" | "embedded";
	/** All applicable checks passed (incl. the threshold when consensus is present). */
	ok: boolean;
	errors: string[];
}

const strip = (h: string): string => (h.startsWith("0x") ? h.slice(2) : h);
const bytes = (h: string): Uint8Array =>
	Uint8Array.from(Buffer.from(strip(h), "hex"));

/**
 * Resolve a reward set directly from a stacks-node (`/v3/stacker_set/{cycle}`),
 * so a caller can verify the consensus layer against a node IT trusts rather than
 * the reward set Secondlayer embedded in the proof. Pass the result as
 * `verifyTransactionProof(proof, { rewardSet })`.
 */
export async function fetchRewardSet(opts: {
	nodeUrl: string;
	cycle: number;
	fetchImpl?: typeof fetch;
}): Promise<RewardSet | null> {
	const f = opts.fetchImpl ?? fetch;
	const res = await f(
		`${opts.nodeUrl.replace(/\/+$/, "")}/v3/stacker_set/${opts.cycle}`,
	);
	if (res.status === 404) return null;
	if (!res.ok) {
		throw new Error(`/v3/stacker_set/${opts.cycle} returned ${res.status}`);
	}
	const body = (await res.json()) as {
		stacker_set: { signers: { signing_key: string; weight: number }[] };
	};
	const signers = body.stacker_set.signers.map((s) => ({
		signing_key: strip(s.signing_key),
		weight: s.weight,
	}));
	return {
		signers,
		total_weight: signers.reduce((sum, s) => sum + s.weight, 0),
	};
}

/**
 * Verify a transaction-inclusion proof. Every check is recomputed client-side,
 * so a `true` result does not rely on trusting Secondlayer. Pass
 * `{ rewardSet }` (resolved via {@link fetchRewardSet} from your own node) to
 * verify the consensus layer against a reward set you trust rather than the one
 * embedded in the proof.
 */
export function verifyTransactionProof(
	proof: TransactionProof,
	opts?: { rewardSet?: RewardSet },
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
	// weigh them against the reward set. A caller-provided `rewardSet` (resolved
	// from a trusted node) takes precedence over the proof's embedded set and makes
	// this fully trustless; otherwise the embedded set is used.
	const rewardSet = opts?.rewardSet ?? proof.consensus?.reward_set;
	let level: "anchored" | "consensus" = "anchored";
	let signerWeightBps: number | undefined;
	let thresholdMet: boolean | undefined;
	let rewardSetSource: "provided" | "embedded" | undefined;
	if (rewardSet) {
		const v = verifySignerSignatures(
			blockHash,
			header.signerSignatures,
			rewardSet,
		);
		signerWeightBps =
			v.totalWeight > 0
				? Math.round((v.signedWeight / v.totalWeight) * 10000)
				: 0;
		thresholdMet = v.thresholdMet;
		rewardSetSource = opts?.rewardSet ? "provided" : "embedded";
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
		rewardSetSource,
		ok: anchoredOk && (rewardSet ? thresholdMet === true : true),
		errors,
	};
}
