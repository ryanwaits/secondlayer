import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBlock } from "./block.ts";

const fixturesDir = join(import.meta.dir, "..", "test", "fixtures");

function readFixture(name: string): string {
	return readFileSync(join(fixturesDir, name), "utf8").trim();
}

/** Wraps a single raw tx hex in a minimal (otherwise-real) block so `parseBlock` can be exercised on it. */
function wrapSingleTxBlock(headerHex: string, txHex: string): string {
	return `${headerHex}01${txHex}`; // tx count = 1 (fits in a single CompactSize byte)
}

describe("parseBlock", () => {
	test("parses the genesis block and computes its known txid", () => {
		const hex = readFixture("genesis-block.hex");
		const block = parseBlock(hex);

		expect(block.prevHash).toBe("0".repeat(64));
		expect(block.time).toBe(1231006505); // 2009-01-03T18:15:05Z, the well-known genesis timestamp
		expect(block.txs).toHaveLength(1);
		expect(block.txs[0]?.txid).toBe(
			"4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
		);
	});

	test("parses a real segwit tx and computes its txid, not its wtxid", () => {
		const headerHex = readFixture("block-900000-header.hex");
		const txHex = readFixture("segwit-tx-900000.hex");
		const block = parseBlock(wrapSingleTxBlock(headerHex, txHex));

		expect(block.txs).toHaveLength(1);
		const tx = block.txs[0];
		expect(tx).toBeDefined();
		// bitcoind-reported txid for this tx (getrawtransaction verbose=true, height 900000).
		expect(tx?.txid).toBe(
			"03d236de860594b8ba35d1260d0c1d098fa8fba143d9c64129458cdbe90da4ba",
		);
		// The wtxid (bitcoind's "hash" field) differs from the txid for a segwit tx —
		// our parser must compute the txid (non-witness serialization), not this.
		expect(tx?.txid).not.toBe(
			"6d8dcbe9f81ae72bc0bfad3304ee30d3bacde01f38b9a3bc1085906a7d84d814",
		);
		expect(tx?.inputs).toHaveLength(1);
		expect(tx?.inputs[0]?.prevTxid).toBe(
			"1f815abdc859aae46e041f1c428d4a3c555f7b05750d15872e332d457963b93b",
		);
		expect(tx?.inputs[0]?.prevVout).toBe(1);
		expect(tx?.inputs[0]?.witness.length).toBeGreaterThan(0);
		expect(tx?.outputs).toHaveLength(2);
	});
});
