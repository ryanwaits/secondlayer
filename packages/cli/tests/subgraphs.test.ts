import { describe, expect, it } from "bun:test";
import { parseStartBlockOption } from "../src/commands/subgraphs.ts";

describe("subgraphs command helpers", () => {
	it("parses deploy --start-block as a nonnegative integer", () => {
		expect(parseStartBlockOption()).toBeUndefined();
		expect(parseStartBlockOption("0")).toBe(0);
		expect(parseStartBlockOption("123")).toBe(123);
		expect(parseStartBlockOption(" 456 ")).toBe(456);
	});

	it("rejects invalid deploy --start-block values", () => {
		for (const value of ["-1", "1.5", "01", "abc", ""]) {
			expect(() => parseStartBlockOption(value)).toThrow(
				"--start-block must be a nonnegative integer",
			);
		}
		expect(() =>
			parseStartBlockOption(String(Number.MAX_SAFE_INTEGER + 1)),
		).toThrow("--start-block must be a safe integer");
	});
});
