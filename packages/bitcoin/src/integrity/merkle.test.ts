import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bytesToHex } from "@noble/hashes/utils.js";
import { parseBlock } from "../block.ts";
import {
	MerkleRootError,
	WitnessCommitmentError,
	merkleRoot,
	verifyBlockIntegrity,
} from "./merkle.ts";

const fixturesDir = join(import.meta.dir, "..", "..", "test", "fixtures");

function readFixture(name: string): string {
	return readFileSync(join(fixturesDir, name), "utf8").trim();
}

/**
 * Flips one byte of `needleHex`'s LAST occurrence in `hex`. Using the last
 * occurrence (not the first) guarantees the mutated byte falls inside
 * whichever transaction `needleHex` was extracted from, even if the same
 * script/witness bytes happen to repeat earlier in the block — nothing
 * follows the source transaction's own copy if it's the block's last tx.
 */
function flipLastOccurrence(hex: string, needleHex: string): string {
	const idx = hex.lastIndexOf(needleHex);
	if (idx === -1) throw new Error(`needle not found: ${needleHex}`);
	const byte = hex.slice(idx, idx + 2);
	const flipped = (Number.parseInt(byte, 16) ^ 0xff)
		.toString(16)
		.padStart(2, "0");
	return hex.slice(0, idx) + flipped + hex.slice(idx + 2);
}

describe("merkleRoot", () => {
	test("a single hash returns itself (genesis block: one coinbase tx)", () => {
		const hash = new Uint8Array(32).fill(7);
		expect(merkleRoot([hash])).toEqual(hash);
	});

	test("duplicates the last hash when a level is odd", () => {
		const a = new Uint8Array(32).fill(1);
		const b = new Uint8Array(32).fill(2);
		const c = new Uint8Array(32).fill(3);
		// 3 leaves: level 1 duplicates c -> [h(a,b), h(c,c)] -> root h(h(a,b), h(c,c))
		const root = merkleRoot([a, b, c]);
		expect(root).toHaveLength(32);
		expect(root).not.toEqual(merkleRoot([a, b]));
	});
});

describe("verifyBlockIntegrity", () => {
	test("genesis block: merkle root is the coinbase txid, no witness commitment, no witnesses", () => {
		const hex = readFixture("genesis-block.hex");
		const block = parseBlock(hex);

		expect(() => verifyBlockIntegrity(block)).not.toThrow();
		expect(block.txs).toHaveLength(1);
		expect(block.txs[0]?.wtxidBytes).toEqual(block.txs[0]?.txidBytes);
	});

	test("real segwit block (965,000): merkle root and witness commitment both verify", () => {
		const hex = readFixture("block-965000.hex");
		const block = parseBlock(hex);

		expect(block.txs.length).toBeGreaterThan(1);
		expect(() => verifyBlockIntegrity(block)).not.toThrow();
	});

	test("wtxid differs from txid for a segwit tx in the real block", () => {
		const hex = readFixture("block-965000.hex");
		const block = parseBlock(hex);
		const segwitTx = block.txs.find((tx) =>
			tx.inputs.some((input) => input.witness.length > 0),
		);
		expect(segwitTx).toBeDefined();
		expect(segwitTx?.wtxidBytes).not.toEqual(segwitTx?.txidBytes);
	});

	test("flipping a byte inside a non-coinbase tx's output script breaks the merkle root", () => {
		const hex = readFixture("block-965000.hex");
		const block = parseBlock(hex);
		const target = block.txs[block.txs.length - 1];
		expect(target).toBeDefined();
		const targetOutput = target?.outputs.find((o) => o.script.length > 0);
		expect(targetOutput).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: asserted above
		const needleHex = bytesToHex(targetOutput!.script);

		const mutatedHex = flipLastOccurrence(hex, needleHex);
		const mutatedBlock = parseBlock(mutatedHex);

		expect(() => verifyBlockIntegrity(mutatedBlock)).toThrow(MerkleRootError);
	});

	test("flipping a byte inside a witness item breaks the witness commitment, not the merkle root", () => {
		const hex = readFixture("block-965000.hex");
		const block = parseBlock(hex);
		const target = block.txs[block.txs.length - 1];
		expect(target).toBeDefined();
		const witnessItem = target?.inputs
			.flatMap((input) => input.witness)
			.find((item) => item.length > 0);
		expect(witnessItem).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: asserted above
		const needleHex = bytesToHex(witnessItem!);

		const mutatedHex = flipLastOccurrence(hex, needleHex);
		const mutatedBlock = parseBlock(mutatedHex);

		// The txid (non-witness serialization) is untouched by a witness-only
		// mutation, so the merkle root itself must still verify...
		const computedRoot = merkleRoot(mutatedBlock.txs.map((tx) => tx.txidBytes));
		expect(computedRoot).toEqual(mutatedBlock.merkleRootBytes);
		// ...but the witness commitment (built from wtxids) must not.
		expect(() => verifyBlockIntegrity(mutatedBlock)).toThrow(
			WitnessCommitmentError,
		);
	});
});
