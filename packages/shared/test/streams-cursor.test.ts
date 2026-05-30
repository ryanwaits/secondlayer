import { describe, expect, test } from "bun:test";
import {
	EMPTY_RANGE_EVENT_INDEX_SENTINEL,
	decodeStreamsCursor,
	encodeStreamsCursor,
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
});
