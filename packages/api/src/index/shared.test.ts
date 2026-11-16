import { describe, expect, test } from "bun:test";
import { jsonSafeBigInt, rangeAwareNextCursor } from "./_shared.ts";

describe("jsonSafeBigInt", () => {
	test("deep-converts BigInt → string so JSON.stringify succeeds", () => {
		// cvToValue yields bigint for Clarity uint/int — leaks into decoded
		// contract-call args/result and throws in c.json + the ETag.
		const decoded: unknown = {
			a: 223n,
			b: [1n, "x", { c: 5n }],
			d: "ok",
			e: 7,
		};
		const safe = jsonSafeBigInt(decoded);
		expect(safe).toEqual({
			a: "223",
			b: ["1", "x", { c: "5" }],
			d: "ok",
			e: 7,
		});
		expect(() => JSON.stringify(safe)).not.toThrow();
	});

	test("handles a scalar bigint and leaves non-bigint untouched", () => {
		expect(jsonSafeBigInt(9n as unknown)).toBe("9");
		expect(jsonSafeBigInt(["a", 2, null] as unknown)).toEqual(["a", 2, null]);
	});
});

describe("rangeAwareNextCursor", () => {
	const base = {
		nextCursor: "10:0",
		rowCount: 5,
		limit: 10,
		order: "asc" as const,
		toHeight: 50,
		tipHeight: 100,
	};

	test("short asc page ending below tip is exhausted", () => {
		expect(rangeAwareNextCursor(base)).toBeNull();
	});

	test("short asc page at tip keeps cursor for live followers", () => {
		expect(rangeAwareNextCursor({ ...base, toHeight: 100 })).toBe("10:0");
	});

	test("full page keeps cursor", () => {
		expect(rangeAwareNextCursor({ ...base, rowCount: 10 })).toBe("10:0");
		expect(rangeAwareNextCursor({ ...base, rowCount: 10, order: "desc" })).toBe(
			"10:0",
		);
	});

	test("short desc page is exhausted", () => {
		expect(
			rangeAwareNextCursor({ ...base, order: "desc", toHeight: 100 }),
		).toBeNull();
	});
});
