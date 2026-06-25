import { describe, expect, test } from "bun:test";
import { bytesToHex, concatBytes, hexToBytes } from "../../utils/encoding.ts";
import {
	bitcoinTxid,
	doubleSha256,
	parseBitcoinTx,
	reverseBytes,
	stripWitness,
} from "../serialize.ts";

// The Bitcoin genesis block coinbase tx (block 0). A legacy, single-input,
// single-output P2PK tx — its displayed txid is one of the most-cited constants
// in Bitcoin.
const GENESIS_COINBASE_RAW =
	"01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000";
const GENESIS_TXID_DISPLAY =
	"4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b";

describe("doubleSha256", () => {
	test("matches the known SHA256d of empty input", () => {
		// sha256d("") — a standard test vector.
		expect(bytesToHex(doubleSha256(new Uint8Array(0)))).toBe(
			"5df6e0e2761359d30a8275058e299fcc0381534545f55cf43e41983f5d4c9456",
		);
	});
});

describe("parseBitcoinTx (legacy)", () => {
	const raw = hexToBytes(GENESIS_COINBASE_RAW);
	const tx = parseBitcoinTx(raw);

	test("computes the genesis txid (internal = reversed display)", () => {
		expect(bytesToHex(reverseBytes(tx.txidInternal))).toBe(
			GENESIS_TXID_DISPLAY,
		);
		expect(bytesToHex(bitcoinTxid(raw, { display: true }))).toBe(
			GENESIS_TXID_DISPLAY,
		);
	});

	test("is not flagged as SegWit", () => {
		expect(tx.hasWitness).toBe(false);
	});

	test("parses the single 50 BTC output", () => {
		expect(tx.inputs).toHaveLength(1);
		expect(tx.outputs).toHaveLength(1);
		expect(tx.outputs[0]?.value).toBe(5_000_000_000n);
	});

	test("stripWitness is a no-op on a legacy tx", () => {
		expect(bytesToHex(stripWitness(raw))).toBe(GENESIS_COINBASE_RAW);
	});
});

describe("parseBitcoinTx (SegWit)", () => {
	// Synthesize a SegWit tx from the genesis legacy tx: insert the 0x0001
	// marker+flag after the version and append an empty witness stack (one
	// 0x00 item-count per input). The legacy txid must be unchanged, since the
	// txid is computed over the witness-stripped serialization.
	const legacy = hexToBytes(GENESIS_COINBASE_RAW);
	const version = legacy.slice(0, 4);
	const body = legacy.slice(4, legacy.length - 4);
	const locktime = legacy.slice(legacy.length - 4);
	const segwit = concatBytes(
		version,
		hexToBytes("0001"), // marker + flag
		body,
		hexToBytes("00"), // witness: 1 input, 0 stack items
		locktime,
	);

	test("detects the SegWit marker/flag", () => {
		expect(parseBitcoinTx(segwit).hasWitness).toBe(true);
	});

	test("computes the same legacy txid as the unwrapped tx", () => {
		expect(bytesToHex(parseBitcoinTx(segwit).txidInternal)).toBe(
			bytesToHex(parseBitcoinTx(legacy).txidInternal),
		);
	});

	test("stripWitness recovers the original legacy bytes", () => {
		expect(bytesToHex(stripWitness(segwit))).toBe(GENESIS_COINBASE_RAW);
	});

	test("parses the same outputs as the legacy form", () => {
		const tx = parseBitcoinTx(segwit);
		expect(tx.outputs).toHaveLength(1);
		expect(tx.outputs[0]?.value).toBe(5_000_000_000n);
	});
});

describe("reverseBytes", () => {
	test("is an involution", () => {
		const b = hexToBytes("0011223344556677");
		expect(bytesToHex(reverseBytes(reverseBytes(b)))).toBe("0011223344556677");
		expect(bytesToHex(reverseBytes(b))).toBe("7766554433221100");
	});
});
