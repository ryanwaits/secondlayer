import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { txidFromBytes } from "@secondlayer/stacks/utils";
import {
	TransactionsError,
	blockTransactions,
	hex,
	parseNakamotoHeader,
	txMerkleRoot,
	unhex,
} from "../src/index.ts";

/** Mainnet blocks with their transactions (also @secondlayer/shared's fixtures). */
const block = (height: number) =>
	unhex(
		readFileSync(
			join(import.meta.dir, "fixtures", "blocks", `${height}.hex`),
			"utf8",
		).trim(),
	);

describe("tx merkle root", () => {
	test("a one-tx block pairs the lone leaf with itself (mainnet 9,070,019)", () => {
		expect(
			hex(
				txMerkleRoot([
					unhex(
						"0a33aeaba279172aa6217e0abf6377de2b703a140f055f99840bbaf738f9cd8e",
					),
				]),
			),
		).toBe("88ee0ce389d2ad57a905101c5c28a4e54a180495812d29f64b560f4c835aec6d");
	});
});

describe("blockTransactions", () => {
	for (const [height, root] of [
		[
			8199502,
			"6b069045a22c625cf7c33c2370ee65845a0d4c8d96a5bafd12eeb21f4b3e6f06",
		],
		// Epoch 4.0 header (v1, problematic_txs) before the body.
		[
			8665568,
			"998aeb7bf431b528ec846b033386015990fac228f0df69d1aeefe8086bbdf15e",
		],
	] as const) {
		test(`mainnet ${height}: every tx parses and the txids hash to the header's root`, () => {
			const raw = block(height);
			const header = parseNakamotoHeader(raw);
			expect(hex(header.txMerkleRoot)).toBe(root);
			const txs = blockTransactions(raw, header);
			expect(txs).toHaveLength(2);
			for (const t of txs ?? []) expect(txidFromBytes(t.raw)).toBe(t.txid);
			expect(hex(txMerkleRoot((txs ?? []).map((t) => unhex(t.txid))))).toBe(
				root,
			);
		});
	}

	test("one flipped byte in a tx signature breaks the root", () => {
		const raw = block(8199502).slice();
		const header = parseNakamotoHeader(raw);
		// First tx, single-sig: its 65-byte signature starts 44 bytes in.
		raw[header.byteLength + 4 + 50] ^= 0x01;
		expect(() => blockTransactions(raw, header)).toThrow(TransactionsError);
		try {
			blockTransactions(raw, header);
		} catch (err) {
			expect((err as TransactionsError).code).toBe("tx-root-mismatch");
		}
	});

	test("trailing bytes after the last tx are malformed, not ignored", () => {
		const good = block(8199502);
		const raw = new Uint8Array(good.length + 1);
		raw.set(good);
		const header = parseNakamotoHeader(raw);
		expect(() => blockTransactions(raw, header)).toThrow(
			"1 bytes after the block's 2 transactions",
		);
	});

	test("a repeated last transaction is malformed even when the root matches", () => {
		const good = block(8199502);
		const header = parseNakamotoHeader(good);
		const txs = blockTransactions(good, header) as NonNullable<
			ReturnType<typeof blockTransactions>
		>;
		const t0 = (txs[0] as { raw: Uint8Array }).raw;
		const t1 = (txs[1] as { raw: Uint8Array }).raw;
		const id0 = unhex((txs[0] as { txid: string }).txid);
		const id1 = unhex((txs[1] as { txid: string }).txid);
		const count = new Uint8Array(4);
		new DataView(count.buffer).setUint32(0, 4);
		const head = good.subarray(0, header.byteLength);
		const raw = new Uint8Array(head.length + 4 + t0.length + t1.length * 3);
		let offset = 0;
		for (const part of [head, count, t0, t1, t1, t1]) {
			raw.set(part, offset);
			offset += part.length;
		}
		const forged = {
			...header,
			txMerkleRoot: txMerkleRoot([id0, id1, id1]),
		};
		expect(hex(txMerkleRoot([id0, id1, id1, id1]))).toBe(
			hex(forged.txMerkleRoot),
		);
		let thrown: unknown;
		try {
			blockTransactions(raw, forged);
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toBeInstanceOf(TransactionsError);
		expect((thrown as TransactionsError).code).toBe("malformed");
		expect((thrown as TransactionsError).message).toContain("duplicate");
	});

	test("header-only bytes have nothing to check", () => {
		const raw = block(8199502);
		const header = parseNakamotoHeader(raw);
		expect(blockTransactions(raw.subarray(0, header.byteLength), header)).toBe(
			null,
		);
	});
});
