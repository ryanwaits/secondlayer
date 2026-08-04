import { describe, expect, test } from "bun:test";
import {
	decodeSortedCursor,
	encodeSortedCursor,
} from "../src/routes/v1-cursor.ts";

describe("v1 sorted cursor codec", () => {
	test("round-trips a NUMERIC value beyond Number.MAX_SAFE_INTEGER as a string", () => {
		const big = "30605870722609774469373";
		expect(Number.isSafeInteger(Number(big))).toBe(false);
		const cursor = encodeSortedCursor("amount", "desc", big, "42");
		const decoded = decodeSortedCursor(cursor, {
			column: "amount",
			order: "desc",
		});
		expect(decoded).toEqual({ value: big, id: "42" });
		expect(typeof decoded.value).toBe("string");
	});

	test("round-trips TEXT containing delimiters and non-ASCII", () => {
		const value = "héllo,wörld;a=b&c=d\"quote'and\\backslash";
		const cursor = encodeSortedCursor("holder", "asc", value, "7");
		const decoded = decodeSortedCursor(cursor, {
			column: "holder",
			order: "asc",
		});
		expect(decoded).toEqual({ value, id: "7" });
	});

	test("round-trips a null sort value (NULL partition)", () => {
		const cursor = encodeSortedCursor("delegate_to", "desc", null, "99");
		const decoded = decodeSortedCursor(cursor, {
			column: "delegate_to",
			order: "desc",
		});
		expect(decoded).toEqual({ value: null, id: "99" });
	});

	test("malformed cursor (not base64url JSON) → invalid cursor error", () => {
		expect(() =>
			decodeSortedCursor("not-a-real-cursor!!", {
				column: "amount",
				order: "desc",
			}),
		).toThrow(/invalid cursor: not-a-real-cursor!!/);
	});

	test("base64url of non-JSON garbage → invalid cursor error", () => {
		const garbage = Buffer.from("just some text", "utf8").toString("base64url");
		expect(() =>
			decodeSortedCursor(garbage, { column: "amount", order: "desc" }),
		).toThrow(/invalid cursor:/);
	});

	test("base64url JSON missing required fields → invalid cursor error", () => {
		const bad = Buffer.from(JSON.stringify({ c: "amount" }), "utf8").toString(
			"base64url",
		);
		expect(() =>
			decodeSortedCursor(bad, { column: "amount", order: "desc" }),
		).toThrow(/invalid cursor:/);
	});

	test("a legacy bare-integer cursor is not a valid sorted cursor", () => {
		// "42" happens to also be valid base64url alphabet, but decodes to
		// non-JSON bytes — must not be silently accepted as a sorted cursor.
		expect(() =>
			decodeSortedCursor("42", { column: "amount", order: "desc" }),
		).toThrow(/invalid cursor: 42/);
	});

	test("cursor issued under a different sort column → 400-shaped mismatch error", () => {
		const cursor = encodeSortedCursor("amount", "desc", "100", "1");
		expect(() =>
			decodeSortedCursor(cursor, { column: "holder", order: "desc" }),
		).toThrow(/_sort=amount/);
		expect(() =>
			decodeSortedCursor(cursor, { column: "holder", order: "desc" }),
		).toThrow(/_sort=holder/);
	});

	test("cursor issued under a different order → mismatch error", () => {
		const cursor = encodeSortedCursor("amount", "desc", "100", "1");
		expect(() =>
			decodeSortedCursor(cursor, { column: "amount", order: "asc" }),
		).toThrow(/_order=desc.*_order=asc/s);
	});

	test("decoded errors are ValidationError-shaped (code VALIDATION_ERROR)", () => {
		try {
			decodeSortedCursor("garbage!!", { column: "amount", order: "desc" });
			throw new Error("expected decodeSortedCursor to throw");
		} catch (e) {
			expect((e as { code?: string }).code).toBe("VALIDATION_ERROR");
		}
	});
});
