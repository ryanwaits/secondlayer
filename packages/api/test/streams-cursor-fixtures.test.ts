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
});
