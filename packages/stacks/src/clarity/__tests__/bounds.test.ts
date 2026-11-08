import { describe, expect, test } from "bun:test";
import { deserializeCV } from "../deserialize.ts";
import { serializeCV, serializeCVBytes } from "../serialize.ts";
import type { ClarityValue } from "../types.ts";
import { Cl, stringAsciiCV } from "../values.ts";

const MAX_U128 = (1n << 128n) - 1n;
const MAX_I128 = (1n << 127n) - 1n;
const MIN_I128 = -(1n << 127n);

describe("128-bit integers", () => {
	test("round-trip at the edges of their range", () => {
		for (const value of [MAX_U128, 0n, 1n]) {
			expect(deserializeCV(serializeCV(Cl.uint(value)))).toEqual(
				Cl.uint(value),
			);
		}
		for (const value of [MAX_I128, MIN_I128, -1n, 0n]) {
			expect(deserializeCV(serializeCV(Cl.int(value)))).toEqual(Cl.int(value));
		}
	});

	test("serializing a hand-built uint past u128 throws instead of writing 17 bytes", () => {
		const tooBig = { type: "uint", value: MAX_U128 + 1n } as ClarityValue;
		expect(() => serializeCVBytes(tooBig)).toThrow(RangeError);
	});

	test("serializing a negative uint throws", () => {
		const negative = { type: "uint", value: -1n } as ClarityValue;
		expect(() => serializeCVBytes(negative)).toThrow(RangeError);
	});

	test("serializing an int outside i128 throws", () => {
		for (const value of [MAX_I128 + 1n, MIN_I128 - 1n]) {
			const outside = { type: "int", value } as ClarityValue;
			expect(() => serializeCVBytes(outside)).toThrow(RangeError);
		}
	});

	test("an empty string is not an integer", () => {
		expect(() => Cl.uint("")).toThrow();
		expect(() => Cl.int("  ")).toThrow();
	});
});

describe("string-ascii", () => {
	test("accepts ASCII", () => {
		expect(stringAsciiCV("hello world").value).toBe("hello world");
	});

	test("rejects characters outside ASCII", () => {
		expect(() => stringAsciiCV("café")).toThrow();
		expect(() => stringAsciiCV("\u{1f600}")).toThrow();
	});

	test("rejects a string longer than a Clarity value can hold", () => {
		expect(() => stringAsciiCV("a".repeat(1_048_577))).toThrow();
	});

	test("serializing a hand-built non-ASCII string throws instead of masking bytes", () => {
		const value = { type: "ascii", value: "Ł" } as ClarityValue;
		expect(() => serializeCVBytes(value)).toThrow();
	});
});
