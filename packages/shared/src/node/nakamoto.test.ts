import { describe, expect, test } from "bun:test";
import fixture from "./__fixtures__/nakamoto-block.json";
import {
	nakamotoBlockHash,
	nakamotoBlockId,
	parseNakamotoBlockHeader,
	stacksTxid,
	txMerkleProof,
	txMerkleRoot,
	verifyTxMerkleProof,
} from "./nakamoto.ts";

// Real mainnet block (stacks-node 3.4.0.0.3) captured offline. These assertions
// reproduce the exact consensus commitments from the raw bytes — if any drift,
// the verifier (and our understanding of the wire format) is wrong.
const raw = Uint8Array.from(Buffer.from(fixture.rawBlockHex, "hex"));
const e = fixture.expect;

describe("Nakamoto header parsing + consensus hashing", () => {
	const header = parseNakamotoBlockHeader(raw);

	test("parses header fields from the raw block", () => {
		expect(header.version).toBe(e.version);
		expect(header.chainLength).toBe(BigInt(e.chainLength));
		expect(header.consensusHash).toBe(e.consensusHash);
		expect(header.txMerkleRoot).toBe(e.txMerkleRoot);
		expect(header.timestamp).toBe(BigInt(e.timestamp));
		expect(header.signerSignatures).toHaveLength(e.signerCount);
		// header_byte_length points exactly at the tx Vec count (= txCount).
		const txCount = new DataView(
			raw.buffer,
			raw.byteOffset + header.headerByteLength,
			4,
		).getUint32(0);
		expect(txCount).toBe(e.txCount);
	});

	test("block_hash = SHA512/256(header minus signer_signature)", () => {
		expect(nakamotoBlockHash(header)).toBe(e.blockHash);
	});

	test("index_block_hash = SHA512/256(block_hash ‖ consensus_hash)", () => {
		expect(nakamotoBlockId(e.blockHash, e.consensusHash)).toBe(
			e.indexBlockHash,
		);
	});

	test("txid = SHA512/256(raw_tx) and tx_merkle_root reproduces the header", () => {
		const txids = (fixture.rawTxs as string[]).map((hex) =>
			stacksTxid(Uint8Array.from(Buffer.from(hex, "hex"))),
		);
		expect(txMerkleRoot(txids)).toBe(e.txMerkleRoot);
	});

	test("tx-inclusion proof: every tx's path folds back to the merkle root", () => {
		const txids = (fixture.rawTxs as string[]).map((hex) =>
			stacksTxid(Uint8Array.from(Buffer.from(hex, "hex"))),
		);
		txids.forEach((txid, i) => {
			const path = txMerkleProof(txids, i);
			expect(verifyTxMerkleProof(txid, path, e.txMerkleRoot)).toBe(true);
		});
		// A tampered txid must fail.
		const badPath = txMerkleProof(txids, 0);
		expect(verifyTxMerkleProof("00".repeat(32), badPath, e.txMerkleRoot)).toBe(
			false,
		);
	});

	test("a flipped index_block_hash byte order does NOT match (guards the gotcha)", () => {
		// consensus ‖ block (the reversed order) must fail.
		const wrong = nakamotoBlockId(e.consensusHash, e.blockHash);
		expect(wrong).not.toBe(e.indexBlockHash);
	});
});
