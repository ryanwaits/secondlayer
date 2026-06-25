import { concatBytes } from "../utils/encoding.ts";
import { doubleSha256 } from "./serialize.ts";

/**
 * A Bitcoin merkle inclusion proof, shaped for the SIP-044 `verify-merkle-proof`
 * built-in: `(leaf-hash, root-hash, tx-index, tx-count, sibling-hashes)`.
 *
 * - `siblings` are the sibling node hashes from the leaf up to (excluding) the
 *   root, in *internal* byte order — never reversed.
 * - `txCount` (not tree-depth) pins the canonical tree shape; the built-in
 *   rejects any proof whose length differs from `ceil(log2(tx-count))`.
 */
export interface MerkleProof {
	siblings: Uint8Array[];
	txIndex: number;
	txCount: number;
}

/** Combine an ordered pair of nodes into their parent hash. */
function hashPair(left: Uint8Array, right: Uint8Array): Uint8Array {
	return doubleSha256(concatBytes(left, right));
}

/** Collapse one merkle level into the next, duplicating the last node if odd. */
function nextLevel(level: Uint8Array[]): Uint8Array[] {
	const next: Uint8Array[] = [];
	for (let i = 0; i < level.length; i += 2) {
		const left = level[i];
		if (left === undefined) throw new Error("merkle: missing left node");
		// Bitcoin duplicates the final node when a level has an odd count.
		const right = level[i + 1] ?? left;
		next.push(hashPair(left, right));
	}
	return next;
}

/**
 * Compute the merkle root over txids in *internal* byte order. The result is
 * also internal order — it matches the `merkle-root` field read straight out of
 * an 80-byte block header, so it can be cross-checked against the header before
 * a proof is trusted.
 */
export function merkleRoot(txidsInternal: Uint8Array[]): Uint8Array {
	if (txidsInternal.length === 0) {
		throw new Error("merkleRoot: empty tx list");
	}
	let level = txidsInternal.slice();
	while (level.length > 1) {
		level = nextLevel(level);
	}
	const root = level[0];
	if (root === undefined) throw new Error("merkleRoot: no root");
	return root;
}

/**
 * Build the merkle inclusion proof for the tx at `txIndex`. Sibling count is
 * exactly `ceil(log2(txCount))`, as the SIP-044 built-in requires.
 */
export function buildMerkleProof(
	txidsInternal: Uint8Array[],
	txIndex: number,
): MerkleProof {
	const txCount = txidsInternal.length;
	if (txCount === 0) {
		throw new Error("buildMerkleProof: empty tx list");
	}
	if (txIndex < 0 || txIndex >= txCount) {
		throw new Error(
			`buildMerkleProof: txIndex ${txIndex} out of range for ${txCount} txs`,
		);
	}

	const siblings: Uint8Array[] = [];
	let index = txIndex;
	let level = txidsInternal.slice();
	while (level.length > 1) {
		const isRight = index % 2 === 1;
		const siblingIndex = isRight ? index - 1 : index + 1;
		const self = level[index];
		if (self === undefined) throw new Error("buildMerkleProof: missing node");
		// When the node is the last of an odd level, it is paired with itself.
		siblings.push(level[siblingIndex] ?? self);
		level = nextLevel(level);
		index = Math.floor(index / 2);
	}

	return { siblings, txIndex, txCount };
}

/**
 * Recompute the merkle root from a leaf + its proof — the same fold the on-chain
 * `verify-merkle-proof` performs. Use it off-chain to self-check a constructed
 * proof against the header's merkle root before submitting a contract call.
 */
export function rootFromProof(
	leafInternal: Uint8Array,
	proof: MerkleProof,
): Uint8Array {
	let hash = leafInternal;
	let index = proof.txIndex;
	for (const sibling of proof.siblings) {
		hash = index % 2 === 1 ? hashPair(sibling, hash) : hashPair(hash, sibling);
		index = Math.floor(index / 2);
	}
	return hash;
}
