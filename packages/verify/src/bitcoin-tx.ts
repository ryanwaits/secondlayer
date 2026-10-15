// Pure Bitcoin transaction inclusion checks: raw tx -> txid -> merkle root.
// Header authentication (is this header in the checkpoint's chain) lives in
// BlockVerifier; nothing here trusts the proof's source.
import {
	type MerkleProof,
	type OutputScriptType,
	type SpvProof,
	formatBitcoinAddress,
	parseBitcoinTx,
	parseBlockHeader,
	parseOutputScript,
	reverseBytes,
	rootFromProof,
	stripWitness,
} from "@secondlayer/stacks/bitcoin";
import { HEADER_SIZE, headerHashHex } from "./bitcoin/header.ts";
import { type Bytes, bytesEqual, hex } from "./bytes.ts";

/** One output of a proven Bitcoin transaction. */
export interface BitcoinTxOutputView {
	vout: number;
	/** Satoshis. */
	amount: bigint;
	script: Bytes;
	type: OutputScriptType;
	/** Mainnet address, when the script has one. */
	address?: string;
}

/**
 * The output fields a proven transaction must match.
 *
 * Every field given has to be equal. `address` compares as a string, `script`
 * byte for byte, `amount` in satoshis.
 */
export interface BitcoinTxExpect {
	address?: string;
	script?: Bytes;
	amount?: bigint;
}

export type TxInclusionCode = "tx-parse" | "txid-mismatch" | "merkle-mismatch";

export interface TxInclusion {
	/** Display-order hex. */
	txid: string;
	/** Display-order hex hash of the proof's header. */
	blockHash: string;
	outputs: BitcoinTxOutputView[];
}

export interface TxInclusionFailure {
	code: TxInclusionCode;
	message: string;
}

/** A stripped serialization of this size can be an inner merkle node (CVE-2017-12842). */
const INNER_NODE_SIZE = 64;

/** Merkle branch length for a block of `txCount` txs. */
function branchLength(txCount: number): number {
	return txCount <= 1 ? 0 : Math.ceil(Math.log2(txCount));
}

function checkBranch(merkle: MerkleProof): string | undefined {
	const { txIndex, txCount, siblings } = merkle;
	if (!Number.isSafeInteger(txCount) || txCount < 1)
		return `tx count ${txCount} is not a positive integer`;
	if (!Number.isSafeInteger(txIndex) || txIndex < 0 || txIndex >= txCount)
		return `tx index ${txIndex} is outside ${txCount} txs`;
	const want = branchLength(txCount);
	if (siblings.length !== want)
		return `branch has ${siblings.length} siblings, a ${txCount}-tx block needs ${want}`;
	if (siblings.some((s) => s.length !== 32))
		return "every sibling must be 32 bytes";
	return undefined;
}

/**
 * Check a proof's bytes agree with each other: the raw tx hashes to the txid,
 * and the txid folds up the branch to the header's merkle root. It says
 * nothing about whether the header is on the real chain.
 */
export function checkTxInclusion(
	proof: SpvProof,
): TxInclusion | TxInclusionFailure {
	const bad = (code: TxInclusionCode, message: string): TxInclusionFailure => ({
		code,
		message,
	});
	if (proof.header.length !== HEADER_SIZE)
		return bad("tx-parse", `header is ${proof.header.length} bytes, not 80`);

	let parsed: ReturnType<typeof parseBitcoinTx>;
	let strippedSize: number;
	try {
		parsed = parseBitcoinTx(proof.rawTx);
		strippedSize = stripWitness(proof.rawTx).length;
	} catch (err) {
		return bad("tx-parse", `raw tx does not parse: ${(err as Error).message}`);
	}
	if (strippedSize === INNER_NODE_SIZE)
		return bad(
			"tx-parse",
			"a 64-byte transaction is indistinguishable from a merkle inner node",
		);
	if (!bytesEqual(parsed.txidInternal, proof.txidInternal))
		return bad(
			"txid-mismatch",
			`raw tx hashes to ${hex(reverseBytes(parsed.txidInternal))}, not ${hex(reverseBytes(proof.txidInternal))}`,
		);

	const branch = checkBranch(proof.merkle);
	if (branch) return bad("merkle-mismatch", branch);
	const root = parseBlockHeader(proof.header).merkleRoot;
	if (!bytesEqual(rootFromProof(parsed.txidInternal, proof.merkle), root))
		return bad(
			"merkle-mismatch",
			"the branch does not fold to the header's merkle root",
		);

	return {
		txid: hex(reverseBytes(parsed.txidInternal)),
		blockHash: headerHashHex(proof.header),
		outputs: parsed.outputs.map((o, vout) => {
			const script = o.scriptPubKey;
			const parsedScript = parseOutputScript(script);
			return {
				vout,
				amount: o.value,
				script,
				type: parsedScript.type,
				address: formatBitcoinAddress(parsedScript, "mainnet"),
			};
		}),
	};
}

/** True when every field `expect` names equals the output's. */
export function outputMatches(
	output: BitcoinTxOutputView,
	expect: BitcoinTxExpect,
): boolean {
	if (expect.address !== undefined && output.address !== expect.address)
		return false;
	if (expect.script !== undefined && !bytesEqual(output.script, expect.script))
		return false;
	if (expect.amount !== undefined && output.amount !== expect.amount)
		return false;
	return true;
}
