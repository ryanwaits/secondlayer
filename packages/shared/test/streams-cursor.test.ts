import { describe, expect, test } from "bun:test";
import {
	EMPTY_RANGE_EVENT_INDEX_SENTINEL,
	StreamsCursorFeedMismatchError,
	blockEndCursor,
	compareStreamsCursor,
	decodeFeedCursor,
	decodeStreamsCursor,
	decodeTaggedStreamsCursor,
	encodeFeedCursor,
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

describe("feed-tagged cursors", () => {
	const position = { block_height: 840_000, event_index: 7 };

	test("bitcoin and vm cursors carry a prefix, classic stays bare", () => {
		expect(encodeFeedCursor("btc", position)).toBe("btc:840000:7");
		expect(encodeFeedCursor("vm", position)).toBe("vm:840000:7");
		expect(encodeFeedCursor("stacks", position)).toBe("840000:7");
	});

	test("a tagged cursor decodes for its own feed", () => {
		expect(decodeFeedCursor("btc:840000:7", "btc")).toEqual(position);
		expect(decodeFeedCursor("vm:840000:7", "vm")).toEqual(position);
	});

	test("an untagged cursor is accepted by every feed", () => {
		for (const feed of ["stacks", "btc", "vm"] as const) {
			expect(decodeFeedCursor("840000:7", feed)).toEqual(position);
		}
	});

	test("a tag for another feed is refused", () => {
		expect(() => decodeFeedCursor("btc:840000:7", "vm")).toThrow(
			StreamsCursorFeedMismatchError,
		);
		expect(() => decodeFeedCursor("vm:840000:7", "stacks")).toThrow(
			StreamsCursorFeedMismatchError,
		);
		expect(() => decodeFeedCursor("btc:840000:7", "stacks")).toThrow(
			/belongs to the btc feed/,
		);
	});

	test("malformed tagged cursors are rejected", () => {
		for (const raw of ["btc:", "btc:1", "vm:vm:1:2", "eth:1:2", "btc:01:2"]) {
			expect(() => decodeTaggedStreamsCursor(raw)).toThrow();
		}
	});

	test("the strict codec still refuses tags so checkpoints stay bare", () => {
		expect(() => decodeStreamsCursor("btc:840000:7")).toThrow();
	});
});
