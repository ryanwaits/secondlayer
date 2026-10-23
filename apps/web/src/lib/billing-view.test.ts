import { describe, expect, test } from "bun:test";
import { parseCapInput } from "./billing-view";

describe("parseCapInput", () => {
	test("accepts whole dollars above zero", () => {
		expect(parseCapInput("40")).toBe(40);
		expect(parseCapInput(" 7 ")).toBe(7);
	});

	test("clears to none for zero, text, and fractions", () => {
		expect(parseCapInput("0")).toBeNull();
		expect(parseCapInput("abc")).toBeNull();
		expect(parseCapInput("12.5")).toBeNull();
		expect(parseCapInput("")).toBeNull();
		expect(parseCapInput("-5")).toBeNull();
	});
});
