import { describe, expect, test } from "bun:test";
import { blockEndCursor, encodeStreamsCursor } from "@secondlayer/shared";
import { Cursor } from "./cursor.ts";
import { ValidationError } from "./errors.ts";

describe("Cursor", () => {
	test("parse round-trips canonical spellings", () => {
		expect(Cursor.parse("0:0")).toEqual({ blockHeight: 0, eventIndex: 0 });
		expect(Cursor.parse("951475:3")).toEqual({
			blockHeight: 951475,
			eventIndex: 3,
		});
	});

	test("parse rejects spellings the server would 400", () => {
		for (const cursor of [
			"951475:",
			":0",
			"01:2",
			"1:02",
			"1e2:0",
			"0x10:0",
			"1:2:3",
			"",
		]) {
			expect(() => Cursor.parse(cursor)).toThrow(ValidationError);
		}
	});

	test("atHeight uses the shared empty-range sentinel", () => {
		expect(Cursor.atHeight(100)).toBe(encodeStreamsCursor(blockEndCursor(99)));
	});

	test("atHeight(0) is null, the pre-genesis position, so the genesis event is not skipped", () => {
		expect(Cursor.atHeight(0)).toBeNull();
		expect(Cursor.atHeight(-1)).toBeNull();
	});
});
