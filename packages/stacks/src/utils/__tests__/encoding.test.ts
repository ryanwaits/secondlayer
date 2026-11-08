import { describe, expect, test } from "bun:test";
import { hexToBytes, intToBigInt } from "../encoding.ts";

describe("hexToBytes", () => {
	test("reads hex with or without 0x", () => {
		expect(Array.from(hexToBytes("0x0aff"))).toEqual([10, 255]);
		expect(Array.from(hexToBytes("0AfF"))).toEqual([10, 255]);
		expect(hexToBytes("").length).toBe(0);
	});

	test("rejects a character that is not hex instead of reading the digits before it", () => {
		expect(() => hexToBytes("1g")).toThrow();
		expect(() => hexToBytes("zz")).toThrow();
		expect(() => hexToBytes("0x12 34")).toThrow();
	});
});

describe("intToBigInt", () => {
	test("an empty or blank string throws rather than reading as zero", () => {
		expect(() => intToBigInt("")).toThrow();
		expect(() => intToBigInt("   ")).toThrow();
	});

	test("still reads numbers, bigints and numeric strings", () => {
		expect(intToBigInt("42")).toBe(42n);
		expect(intToBigInt(7)).toBe(7n);
		expect(intToBigInt(9n)).toBe(9n);
	});
});
