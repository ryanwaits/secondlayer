import { describe, expect, test } from "bun:test";
import { hexToBytes } from "../../utils/encoding.ts";
import { SBTC_BTC_ADDRESS_VERSION, SBTC_EVENT_TOPICS } from "../constants.ts";
import {
	bitcoinTxidFromHex,
	bitcoinTxidToHex,
	formatBtcAddress,
	satsToSbtc,
	sbtcToSats,
	validateBitcoinTxid,
} from "../utils.ts";

describe("formatBtcAddress", () => {
	test("encodes a P2PKH hash160 into a legacy `1...` address", () => {
		// Genesis block coinbase recipient hash160.
		const hashbytes = hexToBytes("62e907b15cbf27d5425399ebf6f0fb50ebb88f18");
		expect(
			formatBtcAddress({
				version: SBTC_BTC_ADDRESS_VERSION.p2pkh,
				hashbytes,
			}),
		).toBe("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
	});

	test("encodes a P2WPKH hash160 into a `bc1q...` address", () => {
		const hashbytes = hexToBytes("751e76e8199196d454941c45d1b3a323f1433bd6");
		expect(
			formatBtcAddress({
				version: SBTC_BTC_ADDRESS_VERSION.p2wpkh,
				hashbytes,
			}),
		).toBe("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
	});

	test("rejects an unknown version byte", () => {
		expect(() =>
			formatBtcAddress({
				version: 0x99,
				hashbytes: new Uint8Array(20),
			}),
		).toThrow(/Unknown BTC address version/);
	});
});

describe("bitcoin txid round-trip", () => {
	test("encodes and decodes a 32-byte txid", () => {
		const buf = new Uint8Array(32).map((_, i) => i);
		const hex = bitcoinTxidToHex(buf);
		expect(hex).toHaveLength(64);
		expect(bitcoinTxidFromHex(hex)).toEqual(buf);
	});

	test("validates the buffer length", () => {
		expect(() => validateBitcoinTxid(new Uint8Array(31))).toThrow(/32 bytes/);
		expect(() => validateBitcoinTxid(new Uint8Array(33))).toThrow(/32 bytes/);
		expect(() => validateBitcoinTxid(new Uint8Array(32))).not.toThrow();
	});
});

describe("sats <-> sbtc string conversions", () => {
	test("formats whole-number satoshis", () => {
		expect(satsToSbtc(0n)).toBe("0");
		expect(satsToSbtc(100_000_000n)).toBe("1");
		expect(satsToSbtc(2_500_000_000n)).toBe("25");
	});

	test("formats fractional satoshis with trailing zeros stripped", () => {
		expect(satsToSbtc(1n)).toBe("0.00000001");
		expect(satsToSbtc(123_456_789n)).toBe("1.23456789");
		expect(satsToSbtc(150_000_000n)).toBe("1.5");
	});

	test("preserves sign for negative amounts", () => {
		expect(satsToSbtc(-100_000_000n)).toBe("-1");
		expect(satsToSbtc(-1n)).toBe("-0.00000001");
	});

	test("parses decimal sBTC strings back to satoshis", () => {
		expect(sbtcToSats("0")).toBe(0n);
		expect(sbtcToSats("1")).toBe(100_000_000n);
		expect(sbtcToSats("0.00000001")).toBe(1n);
		expect(sbtcToSats("1.5")).toBe(150_000_000n);
		expect(sbtcToSats("-1")).toBe(-100_000_000n);
	});

	test("rejects malformed sBTC strings", () => {
		expect(() => sbtcToSats("abc")).toThrow();
		expect(() => sbtcToSats("1.234567890")).toThrow(/8 decimal places/);
	});

	test("round-trips representative amounts", () => {
		const samples = [0n, 1n, 999n, 100_000_000n, 12_345_678_900n];
		for (const sample of samples) {
			expect(sbtcToSats(satsToSbtc(sample))).toBe(sample);
		}
	});
});

describe("event topic registry", () => {
	test("matches the on-chain print contract", () => {
		expect([...SBTC_EVENT_TOPICS]).toEqual([
			"completed-deposit",
			"withdrawal-create",
			"withdrawal-accept",
			"withdrawal-reject",
			"key-rotation",
			"update-protocol-contract",
		]);
	});
});
