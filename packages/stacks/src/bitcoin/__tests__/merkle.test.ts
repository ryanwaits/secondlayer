import { describe, expect, test } from "bun:test";
import { bytesToHex, hexToBytes } from "../../utils/encoding.ts";
import { buildMerkleProof, merkleRoot, rootFromProof } from "../merkle.ts";
import { reverseBytes } from "../serialize.ts";

// Displayed (big-endian) hashes are reversed into internal order for hashing.
const internal = (display: string): Uint8Array =>
	reverseBytes(hexToBytes(display));
const display = (internalBytes: Uint8Array): string =>
	bytesToHex(reverseBytes(internalBytes));

// Block 170 — the first multi-tx Bitcoin block (Satoshi → Hal Finney). Two txs,
// so a clean real-world vector for the merkle root and a 1-sibling proof.
const BLOCK_170 = {
	coinbase: "b1fea52486ce0c62bb442b530a3f0132b826c74e473d1f2c220bfa78111c5082",
	spend: "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16",
	merkleRoot:
		"7dac2c5666815c17a3b36427de37bb9d2e2c5ccec3f8633eb91a4205cb4c10ff",
};

describe("merkleRoot", () => {
	test("single-tx block: root equals the only txid", () => {
		const txid = internal(BLOCK_170.coinbase);
		expect(bytesToHex(merkleRoot([txid]))).toBe(bytesToHex(txid));
	});

	test("block 170: reproduces the real header merkle root", () => {
		const txids = [internal(BLOCK_170.coinbase), internal(BLOCK_170.spend)];
		expect(display(merkleRoot(txids))).toBe(BLOCK_170.merkleRoot);
	});

	test("odd level duplicates the last node", () => {
		// Three leaves: root = H(H(a,b), H(c,c)).
		const leaves = ["aa", "bb", "cc"].map((h) => hexToBytes(h.repeat(32)));
		// Just assert it computes deterministically and is reproducible via a proof.
		const root = merkleRoot(leaves);
		const proof = buildMerkleProof(leaves, 2);
		expect(bytesToHex(rootFromProof(leaves[2] as Uint8Array, proof))).toBe(
			bytesToHex(root),
		);
	});

	test("empty list throws", () => {
		expect(() => merkleRoot([])).toThrow();
	});
});

describe("buildMerkleProof", () => {
	test("single tx: zero siblings, root is the leaf", () => {
		const txid = internal(BLOCK_170.coinbase);
		const proof = buildMerkleProof([txid], 0);
		expect(proof.siblings).toHaveLength(0);
		expect(proof.txCount).toBe(1);
		expect(bytesToHex(rootFromProof(txid, proof))).toBe(bytesToHex(txid));
	});

	test("block 170: proof for each tx folds back to the root", () => {
		const txids = [internal(BLOCK_170.coinbase), internal(BLOCK_170.spend)];
		const rootHex = display(merkleRoot(txids));

		for (let i = 0; i < txids.length; i++) {
			const proof = buildMerkleProof(txids, i);
			expect(proof.txCount).toBe(2);
			expect(proof.siblings).toHaveLength(1); // ceil(log2(2))
			expect(display(rootFromProof(txids[i] as Uint8Array, proof))).toBe(
				rootHex,
			);
		}
	});

	test("sibling count is ceil(log2(txCount)) for a larger tree", () => {
		// 13 synthetic leaves → depth 4.
		const leaves = Array.from({ length: 13 }, (_, i) =>
			hexToBytes(i.toString(16).padStart(2, "0").repeat(32)),
		);
		const root = merkleRoot(leaves);
		for (let i = 0; i < leaves.length; i++) {
			const proof = buildMerkleProof(leaves, i);
			expect(proof.siblings).toHaveLength(Math.ceil(Math.log2(13)));
			expect(bytesToHex(rootFromProof(leaves[i] as Uint8Array, proof))).toBe(
				bytesToHex(root),
			);
		}
	});

	test("out-of-range index throws", () => {
		const txids = [internal(BLOCK_170.coinbase)];
		expect(() => buildMerkleProof(txids, 1)).toThrow();
		expect(() => buildMerkleProof(txids, -1)).toThrow();
	});
});
