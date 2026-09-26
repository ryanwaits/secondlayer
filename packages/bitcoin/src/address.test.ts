import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hexToBytes } from "@noble/hashes/utils.js";
import { addressFromScript } from "./address.ts";
import { parseBlock } from "./block.ts";

const fixturesDir = join(import.meta.dir, "..", "test", "fixtures");

function readFixture(name: string): string {
	return readFileSync(join(fixturesDir, name), "utf8").trim();
}

interface AddressVector {
	type: string;
	txid: string;
	vout: number;
	scriptHex: string;
	address: string;
}

const vectors: AddressVector[] = JSON.parse(
	readFixture("address-vectors-965000.json"),
);

describe("addressFromScript", () => {
	// Real mainnet block 965000, cross-checked independently against
	// Blockstream's Esplora API (blockstream.info/api/block/<hash>/txs) — not
	// our own node/ord, per plan 057 step 1's "published test vectors"
	// preference. Covers all five script types the plan requires.
	for (const vector of vectors) {
		test(`derives the known ${vector.type} address from its scriptPubKey`, () => {
			const script = hexToBytes(vector.scriptHex);
			expect(addressFromScript(script)).toBe(vector.address);
		});
	}

	test("matches the real block's parsed output script bytes, not just the fixture's hex", () => {
		const block = parseBlock(readFixture("block-965000.hex"));
		for (const vector of vectors) {
			const tx = block.txs.find((t) => t.txid === vector.txid);
			expect(tx).toBeDefined();
			const output = tx?.outputs[vector.vout];
			expect(output).toBeDefined();
			expect(addressFromScript(output?.script as Uint8Array)).toBe(
				vector.address,
			);
		}
	});

	test("returns undefined for an OP_RETURN script", () => {
		const opReturn = hexToBytes(
			"6a24aa21a9eda1d51e15bbbb3f501074d424afbf54a56dbabdfc8a7954fcbe8e547d80d09c52",
		);
		expect(addressFromScript(opReturn)).toBeUndefined();
	});

	test("returns undefined for an unassigned witness version", () => {
		// OP_2 <20-byte program> — a real segwit v2+ program shape, but no
		// address type is standardized/assigned for it; must not be confused
		// with P2WPKH (same push length, different version opcode).
		const script = new Uint8Array(22);
		script[0] = 0x52; // OP_2
		script[1] = 0x14;
		expect(addressFromScript(script)).toBeUndefined();
	});
});
