import { describe, expect, test } from "bun:test";
import { bytesToHex, hexToBytes } from "../../utils/encoding.ts";
import {
	type ProofSource,
	buildTxProof,
	esploraSource,
	fallbackProofSource,
} from "../proof.ts";
import { reverseBytes } from "../serialize.ts";

// Real block 170 golden data (the first multi-tx Bitcoin block).
const BLOCK_170 = {
	height: 170,
	header:
		"0100000055bd840a78798ad0da853f68974f3d183e2bd1db6a842c1feecf222a00000000ff104ccb05421ab93e63f8c3ce5c2c2e9dbb37de2764b3a3175c8166562cac7d51b96a49ffff001d283e9e70",
	coinbaseTxid:
		"b1fea52486ce0c62bb442b530a3f0132b826c74e473d1f2c220bfa78111c5082",
	coinbaseRawTx:
		"01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0704ffff001d0102ffffffff0100f2052a01000000434104d46c4968bde02899d2aa0963367c7a6ce34eec332b32e42e5f3407e052d64ac625da6f0718e7b302140434bd725706957c092db53805b821a85b23a7ac61725bac00000000",
	spendTxid: "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16",
};

const internal = (display: string): Uint8Array =>
	reverseBytes(hexToBytes(display));

/** An in-memory source serving block 170's coinbase tx. */
function block170Source(overrides: Partial<ProofSource> = {}): ProofSource {
	return {
		async getRawTx() {
			return hexToBytes(BLOCK_170.coinbaseRawTx);
		},
		async getBlockForTx() {
			return {
				header: hexToBytes(BLOCK_170.header),
				height: BLOCK_170.height,
				txidsInternal: [
					internal(BLOCK_170.coinbaseTxid),
					internal(BLOCK_170.spendTxid),
				],
				txIndex: 0,
			};
		},
		...overrides,
	};
}

describe("buildTxProof", () => {
	test("assembles a proof that reconciles with the header merkle root", async () => {
		const proof = await buildTxProof(block170Source(), {
			txid: BLOCK_170.coinbaseTxid,
			vout: 0,
		});

		expect(bytesToHex(reverseBytes(proof.txidInternal))).toBe(
			BLOCK_170.coinbaseTxid,
		);
		expect(proof.height).toBe(170);
		expect(proof.vout).toBe(0);
		expect(proof.merkle.txIndex).toBe(0);
		expect(proof.merkle.txCount).toBe(2);
		expect(proof.merkle.siblings).toHaveLength(1);
		// The sibling is the other tx in the block, internal order.
		expect(bytesToHex(proof.merkle.siblings[0] as Uint8Array)).toBe(
			bytesToHex(internal(BLOCK_170.spendTxid)),
		);
	});

	test("rejects a source whose raw tx does not match the requested txid", async () => {
		const wrong = block170Source({
			async getRawTx() {
				// Return a different (the spend) tx's bytes — won't hash to the coinbase id.
				return hexToBytes(BLOCK_170.coinbaseRawTx).slice(0, -4);
			},
		});
		await expect(
			buildTxProof(wrong, { txid: BLOCK_170.coinbaseTxid }),
		).rejects.toThrow();
	});

	test("rejects a txIndex that points at the wrong tx", async () => {
		const wrong = block170Source({
			async getBlockForTx() {
				return {
					header: hexToBytes(BLOCK_170.header),
					height: BLOCK_170.height,
					txidsInternal: [
						internal(BLOCK_170.coinbaseTxid),
						internal(BLOCK_170.spendTxid),
					],
					txIndex: 1, // claims the coinbase is at index 1
				};
			},
		});
		await expect(
			buildTxProof(wrong, { txid: BLOCK_170.coinbaseTxid }),
		).rejects.toThrow();
	});

	test("rejects a header whose merkle root does not match the proof", async () => {
		// Flip a byte in the header's merkle-root field.
		const badHeader = hexToBytes(BLOCK_170.header);
		badHeader[36] ^= 0xff;
		const wrong = block170Source({
			async getBlockForTx() {
				return {
					header: badHeader,
					height: BLOCK_170.height,
					txidsInternal: [
						internal(BLOCK_170.coinbaseTxid),
						internal(BLOCK_170.spendTxid),
					],
					txIndex: 0,
				};
			},
		});
		await expect(
			buildTxProof(wrong, { txid: BLOCK_170.coinbaseTxid }),
		).rejects.toThrow(/merkle root/);
	});
});

describe("fallbackProofSource", () => {
	test("falls through to the next source when the first fails", async () => {
		const dead: ProofSource = {
			async getRawTx() {
				throw new Error("primary down");
			},
			async getBlockForTx() {
				throw new Error("primary down");
			},
		};
		const source = fallbackProofSource([dead, block170Source()]);
		const proof = await buildTxProof(source, { txid: BLOCK_170.coinbaseTxid });
		expect(proof.height).toBe(170);
	});

	test("throws the last error when all sources fail", async () => {
		const dead: ProofSource = {
			async getRawTx() {
				throw new Error("down");
			},
			async getBlockForTx() {
				throw new Error("down");
			},
		};
		const source = fallbackProofSource([dead, dead]);
		await expect(source.getRawTx("00".repeat(32))).rejects.toThrow("down");
	});

	test("requires at least one source", () => {
		expect(() => fallbackProofSource([])).toThrow();
	});
});

// Live integration — exercises esploraSource against a real endpoint. Gated on
// an env var so the default suite stays offline/deterministic.
const ESPLORA_URL = process.env.SPV_ESPLORA_URL;
describe.if(Boolean(ESPLORA_URL))("esploraSource (live)", () => {
	test("builds a verifiable proof for block 170's coinbase", async () => {
		const source = esploraSource({ url: ESPLORA_URL as string });
		const proof = await buildTxProof(source, {
			txid: BLOCK_170.coinbaseTxid,
		});
		expect(proof.height).toBe(170);
		expect(proof.merkle.txCount).toBe(2);
	});
});
