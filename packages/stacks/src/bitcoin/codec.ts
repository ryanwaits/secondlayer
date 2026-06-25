import {
	type BufferCV,
	type ClarityValue,
	type ListCV,
	type TupleCV,
	type UIntCV,
	bufferCV,
	listCV,
	uintCV,
} from "../clarity/index.ts";
import { hexToBytes } from "../utils/encoding.ts";
import type { MerkleProof } from "./merkle.ts";

/**
 * Number of merkle levels for a tree of `txCount` leaves — i.e. the exact
 * sibling count the SIP-044 `verify-merkle-proof` built-in expects
 * (`ceil(log2(tx-count))`). Computed by repeated halving to avoid float error
 * at exact powers of two.
 */
function merkleDepth(txCount: number): number {
	let depth = 0;
	let n = txCount;
	while (n > 1) {
		n = Math.ceil(n / 2);
		depth++;
	}
	return depth;
}

/** Max siblings the native `verify-merkle-proof` accepts: `(list 24 (buff 32))`. */
const MAX_SIBLINGS = 24;

function assertHash32(bytes: Uint8Array, label: string): void {
	if (bytes.length !== 32) {
		throw new Error(`${label} must be 32 bytes, got ${bytes.length}`);
	}
}

/**
 * Encode the argument vector for the SIP-044 native built-in
 * `(verify-merkle-proof leaf-hash root-hash tx-index tx-count sibling-hashes)`.
 *
 * Returns the five args in order: `[leaf, root, tx-index, tx-count, siblings]`.
 * All hashes are passed in *internal* (raw) byte order — the built-in does NOT
 * reverse, and neither does this. The leaf is the tx's `txidInternal`; the root
 * is the block header's merkle root in internal order.
 *
 * Throws on shapes the built-in would reject, so a caller fails locally with a
 * clear message instead of an opaque on-chain `false`.
 */
export function encodeMerkleProofArgs(params: {
	leaf: Uint8Array;
	root: Uint8Array;
	proof: MerkleProof;
}): [BufferCV, BufferCV, UIntCV, UIntCV, ListCV] {
	const { leaf, root, proof } = params;
	assertHash32(leaf, "merkle leaf");
	assertHash32(root, "merkle root");

	if (proof.txIndex < 0 || proof.txIndex >= proof.txCount) {
		throw new Error(
			`tx-index ${proof.txIndex} out of range for tx-count ${proof.txCount}`,
		);
	}
	if (proof.siblings.length > MAX_SIBLINGS) {
		throw new Error(
			`proof has ${proof.siblings.length} siblings, native verify-merkle-proof caps at ${MAX_SIBLINGS}`,
		);
	}
	const expectedDepth = merkleDepth(proof.txCount);
	if (proof.siblings.length !== expectedDepth) {
		throw new Error(
			`proof has ${proof.siblings.length} siblings but tx-count ${proof.txCount} requires exactly ${expectedDepth}`,
		);
	}
	for (const [i, sibling] of proof.siblings.entries()) {
		assertHash32(sibling, `sibling ${i}`);
	}

	return [
		bufferCV(leaf),
		bufferCV(root),
		uintCV(proof.txIndex),
		uintCV(proof.txCount),
		listCV(proof.siblings.map((s) => bufferCV(s))),
	];
}

export interface DecodedTxOutput {
	/** scriptPubKey bytes. */
	script: Uint8Array;
	/** Output value in satoshis. */
	amount: bigint;
	/** The tx's txid in internal byte order — ready as a merkle leaf. */
	txid: Uint8Array;
}

function expectBuffer(cv: ClarityValue | undefined, label: string): Uint8Array {
	if (cv?.type !== "buffer") {
		throw new Error(`expected ${label} to be a buffer, got ${cv?.type}`);
	}
	return hexToBytes(cv.value);
}

/**
 * Decode the tuple returned by `get-bitcoin-tx-output?`:
 * `(tuple (script (buff 1024)) (amount uint) (txid (buff 32)))`.
 *
 * Accepts either the bare tuple or a `(response ok ...)` wrapping it, so it
 * works whether or not the caller has already unwrapped the response.
 */
export function decodeTxOutput(cv: ClarityValue): DecodedTxOutput {
	const tuple: ClarityValue = cv.type === "ok" ? cv.value : cv;
	if (tuple.type !== "tuple") {
		throw new Error(`expected a tuple, got ${tuple.type}`);
	}
	const fields = (tuple as TupleCV).value;
	const amount = fields.amount;
	if (amount?.type !== "uint") {
		throw new Error(
			`expected tuple field "amount" to be uint, got ${amount?.type}`,
		);
	}
	return {
		script: expectBuffer(fields.script, 'tuple field "script"'),
		amount: amount.value,
		txid: expectBuffer(fields.txid, 'tuple field "txid"'),
	};
}

export type OutputScriptType =
	| "p2pkh"
	| "p2sh"
	| "p2wpkh"
	| "p2wsh"
	| "p2tr"
	| "op_return"
	| "unknown";

export interface ParsedOutputScript {
	type: OutputScriptType;
	/**
	 * The hash / witness program for the recognized output types: the 20-byte
	 * pubkey-hash (p2pkh), 20-byte script-hash (p2sh), or the 20/32-byte witness
	 * program (p2wpkh/p2wsh/p2tr). Undefined for op_return / unknown.
	 *
	 * Address formatting is intentionally left to the caller — base58/bech32 HRPs
	 * and version bytes are network-dependent, so it belongs where the network is
	 * known (see `verifyBitcoinPayment`), not in this pure decoder.
	 */
	hash?: Uint8Array;
	/** OP_RETURN payload (the pushed data after the OP_RETURN opcode). */
	data?: Uint8Array;
}

const OP_DUP = 0x76;
const OP_HASH160 = 0xa9;
const OP_EQUALVERIFY = 0x88;
const OP_CHECKSIG = 0xac;
const OP_EQUAL = 0x87;
const OP_RETURN = 0x6a;
const OP_0 = 0x00;
const OP_1 = 0x51;

/**
 * Classify a Bitcoin output scriptPubKey by its standard template and surface
 * the embedded hash / witness program. Recognizes P2PKH, P2SH, P2WPKH, P2WSH,
 * P2TR, and OP_RETURN; anything else is `unknown`.
 */
export function parseOutputScript(script: Uint8Array): ParsedOutputScript {
	const n = script.length;

	// P2PKH: OP_DUP OP_HASH160 <20> ... OP_EQUALVERIFY OP_CHECKSIG
	if (
		n === 25 &&
		script[0] === OP_DUP &&
		script[1] === OP_HASH160 &&
		script[2] === 0x14 &&
		script[23] === OP_EQUALVERIFY &&
		script[24] === OP_CHECKSIG
	) {
		return { type: "p2pkh", hash: script.slice(3, 23) };
	}

	// P2SH: OP_HASH160 <20> ... OP_EQUAL
	if (
		n === 23 &&
		script[0] === OP_HASH160 &&
		script[1] === 0x14 &&
		script[22] === OP_EQUAL
	) {
		return { type: "p2sh", hash: script.slice(2, 22) };
	}

	// P2WPKH: OP_0 <20>
	if (n === 22 && script[0] === OP_0 && script[1] === 0x14) {
		return { type: "p2wpkh", hash: script.slice(2, 22) };
	}

	// P2WSH: OP_0 <32>
	if (n === 34 && script[0] === OP_0 && script[1] === 0x20) {
		return { type: "p2wsh", hash: script.slice(2, 34) };
	}

	// P2TR: OP_1 <32>
	if (n === 34 && script[0] === OP_1 && script[1] === 0x20) {
		return { type: "p2tr", hash: script.slice(2, 34) };
	}

	// OP_RETURN: data carrier
	if (n >= 1 && script[0] === OP_RETURN) {
		return { type: "op_return", data: script.slice(1) };
	}

	return { type: "unknown" };
}
