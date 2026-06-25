import { readContract } from "../actions/public/readContract.ts";
import { uintCV } from "../clarity/index.ts";
import type { Client } from "../clients/types.ts";
import { bytesToHex, hexToBytes } from "../utils/encoding.ts";
import { formatBitcoinAddress } from "./address.ts";
import { type OutputScriptType, parseOutputScript } from "./codec.ts";
import type { BitcoinNetwork } from "./constants.ts";
import { type ProofSource, type SpvProof, buildTxProof } from "./proof.ts";
import { parseBitcoinTx, parseBlockHeader } from "./serialize.ts";
import { bitcoinVerifier } from "./verifier.ts";

export interface BitcoinPaymentOutput {
	vout: number;
	/** scriptPubKey bytes. */
	script: Uint8Array;
	/** Value in satoshis. */
	amount: bigint;
	type: OutputScriptType;
	/** Address for the configured network, if the script has a standard one. */
	address?: string;
}

export interface VerifyBitcoinPaymentResult {
	/** `mined` AND every supplied `expect` constraint holds. */
	verified: boolean;
	/** Header authenticated on-chain (if checked) AND merkle inclusion proven. */
	mined: boolean;
	/** Whether the proof's header is the canonical block at its height (per `get-header-merkle-root`). `true` when `authenticateHeader` is off. */
	headerAuthentic: boolean;
	/** Raw merkle-inclusion result from `verify-merkle`. */
	included: boolean;
	/** The decoded output at `vout`. */
	output: BitcoinPaymentOutput;
	/** The proof used (built or supplied). */
	proof: SpvProof;
}

export type VerifyBitcoinPaymentParams = (
	| { proof: SpvProof }
	| { txid: string; source: ProofSource }
) & {
	/** Adapter contract principal, `"address.name"`. */
	contract: string;
	/** Output index to decode and assert against. */
	vout: number;
	/** Network for address formatting. Defaults to mainnet. */
	network?: BitcoinNetwork;
	/** Optional expectations; each supplied field must match for `verified`. */
	expect?: { address?: string; amount?: bigint };
	/**
	 * Confirm the proof's header is the canonical block at its height via
	 * `get-header-merkle-root` (default true). Turn off only when the caller has
	 * already authenticated the header.
	 */
	authenticateHeader?: boolean;
	sender?: string;
};

async function getHeaderMerkleRoot(
	client: Client,
	contract: string,
	height: number,
	sender?: string,
): Promise<Uint8Array | null> {
	const result = await readContract(client, {
		contract,
		functionName: "get-header-merkle-root",
		args: [uintCV(height)],
		sender,
	});
	if (result.type === "none") return null;
	if (result.type === "some" && result.value.type === "buffer") {
		return hexToBytes(result.value.value);
	}
	throw new Error(`unexpected get-header-merkle-root result: ${result.type}`);
}

/**
 * Verify that a Bitcoin payment is committed on-chain and (optionally) matches
 * an expected recipient/amount. Composes the whole SPV flow:
 *  1. build the proof from a `ProofSource` (or accept a prepared `SpvProof`),
 *  2. authenticate the block header at its height (`get-header-merkle-root`),
 *  3. prove tx inclusion under that root (`verify-merkle`),
 *  4. decode the target output and assert any `expect` constraints.
 *
 * The output is decoded off-chain from the proof's raw tx, which is sound: the
 * raw tx is pinned to the proven txid (`buildTxProof` checks it hashes to the
 * leaf), so its bytes are committed.
 */
export async function verifyBitcoinPayment(
	client: Client,
	params: VerifyBitcoinPaymentParams,
): Promise<VerifyBitcoinPaymentResult> {
	const {
		contract,
		vout,
		network = "mainnet",
		expect,
		authenticateHeader = true,
		sender,
	} = params;

	const proof =
		"proof" in params
			? params.proof
			: await buildTxProof(params.source, { txid: params.txid, vout });

	const headerRoot = parseBlockHeader(proof.header).merkleRoot;
	const verifier = bitcoinVerifier(client, { contract, sender });

	let headerAuthentic = true;
	if (authenticateHeader) {
		const authRoot = await getHeaderMerkleRoot(
			client,
			contract,
			proof.height,
			sender,
		);
		headerAuthentic =
			authRoot != null && bytesToHex(authRoot) === bytesToHex(headerRoot);
	}

	const included = await verifier.verifyMerkleProof({
		leaf: proof.txidInternal,
		root: headerRoot,
		proof: proof.merkle,
	});
	const mined = headerAuthentic && included;

	const parsedTx = parseBitcoinTx(proof.rawTx);
	const out = parsedTx.outputs[vout];
	if (!out) {
		throw new Error(
			`vout ${vout} out of range (tx has ${parsedTx.outputs.length} outputs)`,
		);
	}
	const parsedScript = parseOutputScript(out.scriptPubKey);
	const address = formatBitcoinAddress(parsedScript, network);
	const output: BitcoinPaymentOutput = {
		vout,
		script: out.scriptPubKey,
		amount: out.value,
		type: parsedScript.type,
		address,
	};

	const amountOk = expect?.amount === undefined || out.value === expect.amount;
	const addressOk = expect?.address === undefined || address === expect.address;
	const verified = mined && amountOk && addressOk;

	return { verified, mined, headerAuthentic, included, output, proof };
}
