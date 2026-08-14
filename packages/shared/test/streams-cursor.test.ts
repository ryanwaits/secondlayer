import { describe, expect, test } from "bun:test";
import {
	EMPTY_RANGE_EVENT_INDEX_SENTINEL,
	blockEndCursor,
	compareStreamsCursor,
	decodeStreamsCursor,
	encodeStreamsCursor,
	isEmptyRangeCursor,
} from "../src/streams-cursor.ts";

describe("streams cursor codec", () => {
	test("round-trips encode/decode", () => {
		const cursor = { block_height: 150_000, event_index: 3 };
		expect(decodeStreamsCursor(encodeStreamsCursor(cursor))).toEqual(cursor);
	});

	test("encodes as <block>:<index>", () => {
		expect(encodeStreamsCursor({ block_height: 9999, event_index: 0 })).toBe(
			"9999:0",
		);
	});

	test("rejects malformed cursors", () => {
		expect(() => decodeStreamsCursor("abc")).toThrow();
		expect(() => decodeStreamsCursor("1:")).toThrow();
		expect(() => decodeStreamsCursor("01:2")).toThrow(); // no leading zeros
	});

	test("sentinel fits in postgres int4", () => {
		expect(EMPTY_RANGE_EVENT_INDEX_SENTINEL).toBe(2_147_483_647);
	});

	test("compare is height then index, sentinel is last in the block", () => {
		const a = { block_height: 10, event_index: 2 };
		const b = { block_height: 10, event_index: 5 };
		const c = { block_height: 11, event_index: 0 };
		expect(compareStreamsCursor(a, b)).toBeLessThan(0);
		expect(compareStreamsCursor(b, a)).toBeGreaterThan(0);
		expect(compareStreamsCursor(a, a)).toBe(0);
		expect(compareStreamsCursor(b, c)).toBeLessThan(0);
		expect(isEmptyRangeCursor(blockEndCursor(10))).toBe(true);
		expect(compareStreamsCursor(b, blockEndCursor(10))).toBeLessThan(0);
	});
});
