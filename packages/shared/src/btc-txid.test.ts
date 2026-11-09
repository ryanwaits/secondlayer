import { describe, expect, it } from "bun:test";
import { normalizeBtcTxid } from "./btc-txid.ts";

const HEX = "5c9ef4e964b7747cc53833d44cd0445aa254f5830eb9a520537fdf297bfc9480";

describe("normalizeBtcTxid", () => {
	it("prefixes bare explorer hex with 0x", () => {
		expect(normalizeBtcTxid(HEX)).toBe(`0x${HEX}`);
	});

	it("lowercases uppercase hex and prefix", () => {
		expect(normalizeBtcTxid(`0X${HEX.toUpperCase()}`)).toBe(`0x${HEX}`);
	});

	it("keeps the stored form unchanged", () => {
		expect(normalizeBtcTxid(`0x${HEX}`)).toBe(`0x${HEX}`);
	});

	it("rejects values that are not a 32-byte hex txid", () => {
		expect(normalizeBtcTxid("abc")).toBeNull();
		expect(normalizeBtcTxid(`0x${HEX}00`)).toBeNull();
		expect(normalizeBtcTxid(`${HEX.slice(0, 63)}*`)).toBeNull();
	});
});
