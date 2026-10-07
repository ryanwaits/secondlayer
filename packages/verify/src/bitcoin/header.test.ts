import { describe, expect, test } from "bun:test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { headerHashHex, parseHeader, serializeHeader } from "./header.ts";

const GENESIS =
	"0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c";

describe("block header", () => {
	test("parses the genesis header fields", () => {
		const h = parseHeader(GENESIS);
		expect(h.version).toBe(1);
		expect(h.prevHash).toBe("00".repeat(32));
		expect(h.merkleRoot).toBe(
			"4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
		);
		expect(h.time).toBe(1231006505);
		expect(h.bits).toBe(0x1d00ffff);
		expect(h.nonce).toBe(2083236893);
	});

	test("hash is double-SHA256 in display order", () => {
		expect(headerHashHex(GENESIS)).toBe(
			"000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f",
		);
	});

	test("serialize inverts parse", () => {
		expect(bytesToHex(serializeHeader(parseHeader(GENESIS)))).toBe(GENESIS);
	});

	test("rejects wrong length", () => {
		expect(() => parseHeader("00")).toThrow(RangeError);
	});
});
