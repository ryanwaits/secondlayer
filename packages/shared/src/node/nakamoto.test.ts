import { describe, expect, test } from "bun:test";
import epoch4 from "./__fixtures__/nakamoto-block-epoch4.json";
import fixture from "./__fixtures__/nakamoto-block.json";
import {
	nakamotoBlockHash,
	nakamotoBlockId,
	parseNakamotoBlockHeader,
	sha512_256,
	stacksTxid,
	txMerkleProof,
	txMerkleRoot,
	verifyTxMerkleProof,
	versionIncludesProblematicTxs,
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
		expect(header.problematicTxs).toEqual([]);
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

describe("Epoch 4.0 Nakamoto header (problematic_txs)", () => {
	const raw = Uint8Array.from(Buffer.from(epoch4.rawBlockHex, "hex"));
	const e4 = epoch4.expect;
	const header = parseNakamotoBlockHeader(raw);

	test("version 1 is the Epoch 4.0 header and includes an empty marker list", () => {
		expect(header.version).toBe(e4.version);
		expect(versionIncludesProblematicTxs(header.version)).toBe(true);
		expect(header.chainLength).toBe(BigInt(e4.chainLength));
		expect(header.consensusHash).toBe(e4.consensusHash);
		expect(header.txMerkleRoot).toBe(e4.txMerkleRoot);
		expect(header.timestamp).toBe(BigInt(e4.timestamp));
		expect(header.signerSignatures).toHaveLength(e4.signerCount);
		expect(header.problematicTxs).toEqual([]);
		const txCount = new DataView(
			raw.buffer,
			raw.byteOffset + header.headerByteLength,
			4,
		).getUint32(0);
		expect(txCount).toBe(e4.txCount);
	});

	test("block_hash includes the serialized problematic_txs field", () => {
		expect(nakamotoBlockHash(header)).toBe(e4.blockHash);
	});

	test("index_block_hash matches the node's identity", () => {
		expect(nakamotoBlockId(e4.blockHash, e4.consensusHash)).toBe(
			e4.indexBlockHash,
		);
	});

	test("omitting the empty marker vec does NOT reproduce the block_hash", () => {
		// This is the 2026-08-13 auditor miss: v1 headers always serialize a
		// u32 count, even when the list is empty. Dropping those 4 bytes is a
		// different preimage.
		const withoutMarkers = header.signerSignatureHashPreimage.subarray(
			0,
			header.signerSignatureHashPreimage.length - 4,
		);
		const wrong = Buffer.from(sha512_256(withoutMarkers)).toString("hex");
		expect(wrong).not.toBe(e4.blockHash);
	});
});
