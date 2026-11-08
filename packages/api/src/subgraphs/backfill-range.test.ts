import { describe, expect, test } from "bun:test";
import { ZodError } from "zod";
import { parseBackfillRange } from "./backfill-range.ts";

function messages(body: unknown, tip = 1000): string[] {
	try {
		parseBackfillRange(body, tip);
	} catch (error) {
		if (error instanceof ZodError) return error.issues.map((i) => i.message);
		throw error;
	}
	return [];
}

describe("parseBackfillRange", () => {
	test("accepts a whole-block range at or below the tip", () => {
		expect(parseBackfillRange({ fromBlock: 10, toBlock: 20 }, 1000)).toEqual({
			fromBlock: 10,
			toBlock: 20,
		});
		expect(parseBackfillRange({ fromBlock: 5, toBlock: 5 }, 5)).toEqual({
			fromBlock: 5,
			toBlock: 5,
		});
	});

	test("refuses a missing bound", () => {
		expect(messages({ fromBlock: 10 })).toContain(
			"toBlock is required and must be a number",
		);
		expect(messages({})).toHaveLength(2);
	});

	test("refuses fractions, strings and non-positive blocks", () => {
		expect(messages({ fromBlock: 1.5, toBlock: 20 })).toContain(
			"fromBlock must be an integer",
		);
		expect(messages({ fromBlock: "10", toBlock: 20 })).toContain(
			"fromBlock is required and must be a number",
		);
		expect(messages({ fromBlock: 0, toBlock: 20 })).toContain(
			"fromBlock must be at least 1",
		);
		expect(messages({ fromBlock: -3, toBlock: 20 })).toContain(
			"fromBlock must be at least 1",
		);
	});

	test("refuses a range written backwards", () => {
		expect(messages({ fromBlock: 30, toBlock: 20 })).toContain(
			"fromBlock must be at or below toBlock",
		);
	});

	test("refuses a range reaching past the chain tip", () => {
		expect(messages({ fromBlock: 10, toBlock: 1001 })).toContain(
			"toBlock must be at or below the chain tip (1000)",
		);
	});
});
