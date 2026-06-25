import { readContract } from "../actions/public/readContract.ts";
import {
	type ClarityValue,
	bufferCV,
	listCV,
	uintCV,
} from "../clarity/index.ts";
import type { Client } from "../clients/types.ts";
import {
	type DecodedTxOutput,
	decodeTxOutput,
	encodeMerkleProofArgs,
} from "./codec.ts";
import type { MerkleProof } from "./merkle.ts";
import type { SpvProof } from "./proof.ts";
import { parseBlockHeader } from "./serialize.ts";

export interface BitcoinVerifierConfig {
	/** Adapter contract principal, `"address.name"` (the reference `spv-adapter` or an integrator's own). */
	contract: string;
	/** Optional read-only call sender; defaults to the contract address. */
	sender?: string;
}

export interface BitcoinVerifier {
	/**
	 * Verify a merkle inclusion proof against a supplied root via the adapter's
	 * `verify-merkle` (the native `verify-merkle-proof`). This proves membership
	 * under `root`; authenticating that `root` belongs to a canonical Bitcoin
	 * block is a separate step (header → height), composed in `verifyBitcoinPayment`.
	 */
	verifyMerkleProof(input: {
		leaf: Uint8Array;
		root: Uint8Array;
		proof: MerkleProof;
	}): Promise<boolean>;
	/** Verify an `SpvProof`'s merkle inclusion against its own header root (membership only — not chain-authenticated). */
	verifySpvProof(proof: SpvProof): Promise<boolean>;
	/**
	 * Full header-authenticated SPV check via the adapter's `was-tx-mined`: the
	 * contract authenticates the proof's header against the chain
	 * (`get-burn-block-info? header-hash`), extracts its root, and proves
	 * inclusion — atomically. Returns `false` if the header isn't canonical at
	 * its height or the tx isn't included. This is the real "is it on Bitcoin" check.
	 */
	wasTxMined(proof: SpvProof): Promise<boolean>;
	/**
	 * Decode one output of a serialized Bitcoin tx via the adapter's
	 * `get-tx-output` (the native `get-bitcoin-tx-output?`).
	 */
	getTxOutput(rawTx: Uint8Array, vout: number): Promise<DecodedTxOutput>;
}

function clarityToBool(cv: ClarityValue): boolean {
	const value = cv.type === "ok" ? cv.value : cv;
	if (value.type === "true") return true;
	if (value.type === "false") return false;
	throw new Error(`expected a boolean result, got ${value.type}`);
}

/**
 * Bind a `BitcoinVerifier` to a deployed adapter contract. There is a single,
 * native target — no caps and no legacy `clarity-bitcoin` path. The built-ins do
 * not exist until Clarity 6 / Epoch 4.0 activates, so read-only calls only
 * succeed on a node at that epoch (a local Clarity-6 devnet, or mainnet after
 * activation); guard with `isClarity6Active` when in doubt.
 */
export function bitcoinVerifier(
	client: Client,
	config: BitcoinVerifierConfig,
): BitcoinVerifier {
	const { contract, sender } = config;

	async function verifyMerkleProof(input: {
		leaf: Uint8Array;
		root: Uint8Array;
		proof: MerkleProof;
	}): Promise<boolean> {
		const args = encodeMerkleProofArgs(input);
		const result = await readContract(client, {
			contract,
			functionName: "verify-merkle",
			args,
			sender,
		});
		return clarityToBool(result);
	}

	return {
		verifyMerkleProof,
		verifySpvProof(proof) {
			const root = parseBlockHeader(proof.header).merkleRoot;
			return verifyMerkleProof({
				leaf: proof.txidInternal,
				root,
				proof: proof.merkle,
			});
		},
		async wasTxMined(proof) {
			const result = await readContract(client, {
				contract,
				functionName: "was-tx-mined",
				args: [
					bufferCV(proof.header),
					uintCV(proof.height),
					bufferCV(proof.txidInternal),
					uintCV(proof.merkle.txIndex),
					uintCV(proof.merkle.txCount),
					listCV(proof.merkle.siblings.map((s) => bufferCV(s))),
				],
				sender,
			});
			// (response bool uint): (ok true) mined, (ok false) not, (err) bad header → fail closed.
			if (result.type === "err") return false;
			return clarityToBool(result);
		},
		async getTxOutput(rawTx, vout) {
			const result = await readContract(client, {
				contract,
				functionName: "get-tx-output",
				args: [bufferCV(rawTx), uintCV(vout)],
				sender,
			});
			if (result.type === "err") {
				throw new Error(
					`get-tx-output failed on-chain: ${JSON.stringify(result.value)}`,
				);
			}
			return decodeTxOutput(result);
		},
	};
}
