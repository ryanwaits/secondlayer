import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	parseNakamotoBlockHeader,
	stacksTxid,
	txMerkleProof,
} from "@secondlayer/shared/node/nakamoto";
import { type TransactionProof, verifyTransactionProof } from "./proofs.ts";

// Reuse the verified mainnet fixture from shared to assemble real proofs.
const fx = JSON.parse(
	readFileSync(
		new URL(
			"../../shared/src/node/__fixtures__/nakamoto-block.json",
			import.meta.url,
		),
		"utf8",
	),
);
const raw = Uint8Array.from(Buffer.from(fx.rawBlockHex, "hex"));
const header = parseNakamotoBlockHeader(raw);
const rawHeaderHex = Buffer.from(
	raw.subarray(0, header.headerByteLength),
).toString("hex");
const rawTxs = fx.rawTxs as string[];
const txids = rawTxs.map((h) =>
	stacksTxid(Uint8Array.from(Buffer.from(h, "hex"))),
);

function proofFor(i: number): TransactionProof {
	return {
		txid: txids[i],
		index_block_hash: fx.expect.indexBlockHash,
		block_height: fx.expect.chainLength,
		tx_index: i,
		raw_tx: rawTxs[i],
		raw_header: rawHeaderHex,
		tx_merkle_path: txMerkleProof(txids, i),
	};
}

describe("verifyTransactionProof (anchored)", () => {
	test("a well-formed proof for each tx verifies", () => {
		for (let i = 0; i < txids.length; i++) {
			const r = verifyTransactionProof(proofFor(i));
			expect(r.ok).toBe(true);
			expect(r.errors).toEqual([]);
		}
	});

	test("a tampered raw_tx fails (txid no longer matches)", () => {
		const p = proofFor(0);
		p.raw_tx = `ff${p.raw_tx.slice(2)}`;
		const r = verifyTransactionProof(p);
		expect(r.ok).toBe(false);
		expect(r.txidMatches).toBe(false);
	});

	test("a tampered index_block_hash fails header self-consistency", () => {
		const p = proofFor(0);
		p.index_block_hash = "ff".repeat(32);
		const r = verifyTransactionProof(p);
		expect(r.ok).toBe(false);
		expect(r.headerSelfConsistent).toBe(false);
	});

	test("a tampered merkle sibling fails inclusion", () => {
		const p = proofFor(0);
		if (p.tx_merkle_path.length > 0) {
			p.tx_merkle_path[0] = { ...p.tx_merkle_path[0], hash: "00".repeat(32) };
		}
		const r = verifyTransactionProof(p);
		expect(r.ok).toBe(false);
		expect(r.includedInHeader).toBe(false);
	});
});
