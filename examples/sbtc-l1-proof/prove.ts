// T4 — join the two halves: take a deposit's `bitcoin_txid` + `vout`, build its
// Bitcoin SPV proof from a public Esplora source, and exercise the SIP-044
// built-ins on-chain (in simnet) through the spv-adapter:
//
//   verify-merkle-proof  → the tx is committed under the block's merkle root
//   get-bitcoin-tx-output? → decode the funded output (amount + recipient)
//
// What this proves: the bytes the SDK encodes are exactly what the native
// built-ins accept, and the deposit's Bitcoin output decodes as claimed. It is
// NOT yet chain-authentication — `verify-merkle` checks inclusion under a
// caller-supplied root, and simnet's burn headers are synthetic. The full
// header-authenticated check (`was-tx-mined` against `get-burn-block-info?`) is
// the one-line upgrade at Epoch 4.0 on a live Clarity-6 node. See README.

import {
	buildTxProof,
	decodeTxOutput,
	encodeMerkleProofArgs,
	esploraSource,
	formatBitcoinAddress,
	parseBlockHeader,
	parseOutputScript,
} from "@secondlayer/stacks/bitcoin";
import {
	type ClarityValue,
	bufferCV,
	uintCV,
} from "@secondlayer/stacks/clarity";
import { type Deposit, PINNED_DEPOSIT } from "./deposits.ts";
import { callRO } from "./simnet.ts";

const ESPLORA = process.env.ESPLORA_URL ?? "https://blockstream.info/api";

export interface ProofResult {
	bitcoinTxid: string;
	vout: number;
	/** verify-merkle-proof confirmed inclusion under the block's merkle root. */
	included: boolean;
	/** Sats sent to the funded output, decoded by get-bitcoin-tx-output?. */
	btcOutputSats: bigint;
	/** Recipient (the sBTC peg wallet) for the funded output. */
	recipient?: string;
	/** sBTC minted for this deposit (btcOutputSats minus the protocol fee). */
	sbtcMintedSats: bigint;
}

const isTrue = (cv: ClarityValue): boolean => cv.type === "true";

export async function proveDeposit(deposit: Deposit): Promise<ProofResult> {
	const source = esploraSource({ url: ESPLORA });
	const proof = await buildTxProof(source, {
		txid: deposit.bitcoinTxid,
		vout: deposit.vout,
	});

	// 1. Native merkle inclusion, on-chain. Root comes from the proof's real
	//    block header; encodeMerkleProofArgs shapes the exact built-in args.
	const root = parseBlockHeader(proof.header).merkleRoot;
	const merkleArgs = encodeMerkleProofArgs({
		leaf: proof.txidInternal,
		root,
		proof: proof.merkle,
	});
	const included = isTrue(await callRO("verify-merkle", merkleArgs));

	// 2. Native output decode, on-chain.
	const out = decodeTxOutput(
		await callRO("get-tx-output", [
			bufferCV(proof.rawTx),
			uintCV(deposit.vout),
		]),
	);
	const recipient = formatBitcoinAddress(
		parseOutputScript(out.script),
		"mainnet",
	);

	return {
		bitcoinTxid: deposit.bitcoinTxid,
		vout: deposit.vout,
		included,
		btcOutputSats: out.amount,
		recipient,
		sbtcMintedSats: deposit.sbtcAmountSats,
	};
}

if (import.meta.main) {
	const result = await proveDeposit(PINNED_DEPOSIT);
	console.log(result);
}
