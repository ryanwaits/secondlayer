import type { Client } from "../clients/types.ts";
import { formatBitcoinAddress } from "./address.ts";
import { type OutputScriptType, parseOutputScript } from "./codec.ts";
import {
	type BitcoinNetwork,
	getSpvAdapter,
	spvAdapterPrincipal,
} from "./constants.ts";
import { type ProofSource, type SpvProof, buildTxProof } from "./proof.ts";
import { parseBitcoinTx } from "./serialize.ts";
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
	/**
	 * On-chain proof that the tx is committed in a Bitcoin block. With
	 * `authenticateHeader` (default), this is the adapter's `was-tx-mined` —
	 * header authenticated against the chain AND merkle inclusion. With it off,
	 * it is merkle inclusion against the proof's own (unauthenticated) header.
	 */
	mined: boolean;
	/** The decoded output at `vout`. */
	output: BitcoinPaymentOutput;
	/** The proof used (built or supplied). */
	proof: SpvProof;
}

export type VerifyBitcoinPaymentParams = (
	| { proof: SpvProof }
	| { txid: string; source: ProofSource }
) & {
	/**
	 * Adapter contract principal, `"address.name"`. Optional once a reference
	 * adapter is published for `network` (see `SPV_ADAPTER_CONTRACTS`); until then
	 * it is required.
	 */
	contract?: string;
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

/**
 * Verify that a Bitcoin payment is committed on-chain and (optionally) matches
 * an expected recipient/amount. Composes the whole SPV flow:
 *  1. build the proof from a `ProofSource` (or accept a prepared `SpvProof`),
 *  2. prove the tx is mined — `was-tx-mined` (header authenticated against the
 *     chain + merkle inclusion) by default, or membership-only when
 *     `authenticateHeader` is off,
 *  3. decode the target output and assert any `expect` constraints.
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

	const adapter = getSpvAdapter(network);
	const resolvedContract =
		contract ?? (adapter ? spvAdapterPrincipal(adapter) : undefined);
	if (!resolvedContract) {
		throw new Error(
			`No spv-adapter deployed for ${network} — pass an explicit \`contract\`, or wait for Clarity 6 / Epoch 4.0 (deploy recipe: contracts/README.md).`,
		);
	}

	const proof =
		"proof" in params
			? params.proof
			: await buildTxProof(params.source, { txid: params.txid, vout });

	const verifier = bitcoinVerifier(client, {
		contract: resolvedContract,
		sender,
	});
	const mined = authenticateHeader
		? await verifier.wasTxMined(proof)
		: await verifier.verifySpvProof(proof);

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

	return { verified, mined, output, proof };
}
