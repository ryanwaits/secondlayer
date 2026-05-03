import { describe, expect, test } from "bun:test";
import {
	decodeStreamsCursor,
	encodeStreamsCursor,
} from "../src/streams/cursor.ts";

type StreamsFixtureEvent = {
	cursor: string;
	block_height: number;
	event_index: number;
};

const fixturePath = new URL(
	"./fixtures/streams-cursor-fixtures.json",
	import.meta.url,
);
const fixtures = (await Bun.file(fixturePath).json()) as StreamsFixtureEvent[];

describe("Stacks Streams cursor fixtures", () => {
	test("fixtures lock cursor encoding for canonical events", () => {
		expect(fixtures).toHaveLength(100);

		for (const event of fixtures) {
			expect(encodeStreamsCursor(event)).toBe(event.cursor);
			expect(decodeStreamsCursor(event.cursor)).toEqual({
				block_height: event.block_height,
				event_index: event.event_index,
			});
		}
	});

	test("cursor parse/serialize round-trips edge values", () => {
		const cases = [
			{ block_height: 0, event_index: 0 },
			{ block_height: 9_007_199_254_740_991, event_index: 0 },
			{ block_height: 9_007_199_254_740_991, event_index: 9_007_199_254_740_991 },
		];

		for (const cursor of cases) {
			expect(decodeStreamsCursor(encodeStreamsCursor(cursor))).toEqual(cursor);
		}
	});

	test("rejects non-canonical cursor spellings", () => {
		expect(() => decodeStreamsCursor("00182431:14")).toThrow(
			"Invalid Streams cursor",
		);
		expect(() => decodeStreamsCursor("182431:014")).toThrow(
			"Invalid Streams cursor",
		);
	});
});
