/**
 * Block integrity: Bitcoin's txid merkle root and the BIP-141 witness
 * commitment. Not a port of any ord file — ord relies on the `bitcoin` crate
 * and its own trusted node for this; we verify it ourselves against the raw
 * block bytes before applying anything, since it's the only on-chain anchor
 * for the bytes the Runes decoder reads (see plan 039 "Why this matters").
 */

import { sha256 } from "@noble/hashes/sha2.js";
import type { ParsedBlock } from "../block.ts";

export class MerkleRootError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MerkleRootError";
	}
}

export class WitnessCommitmentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WitnessCommitmentError";
	}
}

function doubleSha256(data: Uint8Array): Uint8Array {
	return sha256(sha256(data));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
	const total = chunks.reduce((n, c) => n + c.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out;
}

/**
 * Bitcoin's merkle root algorithm over internal-byte-order hashes: pairwise
 * `doubleSha256(a‖b)`, duplicating the last hash when a level is odd, until
 * one hash remains. A single-hash input returns that hash unchanged (the
 * genesis-block / single-coinbase-tx case).
 */
export function merkleRoot(hashes: Uint8Array[]): Uint8Array {
	if (hashes.length === 0) {
		throw new MerkleRootError("merkleRoot: no hashes given");
	}
	let level = hashes;
	while (level.length > 1) {
		const next: Uint8Array[] = [];
		for (let i = 0; i < level.length; i += 2) {
			// biome-ignore lint/style/noNonNullAssertion: i < level.length by loop bound
			const a = level[i]!;
			const b = i + 1 < level.length ? (level[i + 1] as Uint8Array) : a;
			next.push(doubleSha256(concatBytes([a, b])));
		}
		level = next;
	}
	// biome-ignore lint/style/noNonNullAssertion: level.length === 1 here
	return level[0]!;
}

/** BIP-141 witness commitment output prefix: OP_RETURN, push 36 bytes, then the 4-byte commitment header. */
const WITNESS_COMMITMENT_PREFIX = Uint8Array.of(
	0x6a,
	0x24,
	0xaa,
	0x21,
	0xa9,
	0xed,
);

function hasWitnessCommitmentPrefix(script: Uint8Array): boolean {
	if (script.length < WITNESS_COMMITMENT_PREFIX.length + 32) return false;
	for (let i = 0; i < WITNESS_COMMITMENT_PREFIX.length; i++) {
		if (script[i] !== WITNESS_COMMITMENT_PREFIX[i]) return false;
	}
	return true;
}

/**
 * Verifies a parsed block's txid merkle root against its header, and its
 * BIP-141 witness commitment (if present) against the coinbase transaction.
 * Throws on any mismatch — this is a fail-closed check, never a warning.
 */
export function verifyBlockIntegrity(block: ParsedBlock): void {
	const computedRoot = merkleRoot(block.txs.map((tx) => tx.txidBytes));
	if (!bytesEqual(computedRoot, block.merkleRootBytes)) {
		throw new MerkleRootError(
			`merkle root mismatch at block ${block.hash}: computed ${Buffer.from(computedRoot).toString("hex")}, header has ${Buffer.from(block.merkleRootBytes).toString("hex")}`,
		);
	}

	const coinbase = block.txs[0];
	if (!coinbase) {
		throw new MerkleRootError(`block ${block.hash} has no transactions`);
	}

	// Find the LAST coinbase output whose script starts with the witness
	// commitment prefix (BIP-141: if more than one matches, the last is used).
	let commitmentScript: Uint8Array | undefined;
	for (const output of coinbase.outputs) {
		if (hasWitnessCommitmentPrefix(output.script)) {
			commitmentScript = output.script;
		}
	}

	if (commitmentScript !== undefined) {
		const witnessRootHashes = [
			new Uint8Array(32),
			...block.txs.slice(1).map((tx) => tx.wtxidBytes),
		];
		const witnessRoot = merkleRoot(witnessRootHashes);

		const reserved = coinbase.inputs[0]?.witness[0];
		if (!reserved || reserved.length !== 32) {
			throw new WitnessCommitmentError(
				`block ${block.hash}: coinbase is missing its 32-byte witness reserved value`,
			);
		}

		const expected = doubleSha256(concatBytes([witnessRoot, reserved]));
		const commitment = commitmentScript.slice(6, 38);
		if (!bytesEqual(expected, commitment)) {
			throw new WitnessCommitmentError(
				`witness commitment mismatch at block ${block.hash}: computed ${Buffer.from(expected).toString("hex")}, coinbase commits to ${Buffer.from(commitment).toString("hex")}`,
			);
		}
	} else {
		for (const tx of block.txs) {
			for (const input of tx.inputs) {
				if (input.witness.length > 0) {
					throw new WitnessCommitmentError(
						`block ${block.hash}: tx ${tx.txid} carries witness data but the block has no witness commitment output`,
					);
				}
			}
		}
	}
}
