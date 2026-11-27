import { describe, expect, test } from "bun:test";
import {
	decodePrint,
	printPayloadFromStored,
	printRawValueBytes,
} from "../src/streams-rows/index.ts";
import type { StreamsEvent } from "../src/streams-rows/index.ts";

const RAW_VALUES = [
	`0x0c00000001016101${"00".repeat(15)}01`,
	`0x01${"00".repeat(15)}2a`,
	"0x0d0000000568656c6c6f",
	"0x0a0100000000000000000000000000000007",
];

function printEvent(rawValue: string): StreamsEvent {
	return {
		cursor: "1:0",
		block_height: 1,
		tx_id: "0xabc",
		tx_index: 0,
		event_index: 0,
		event_type: "print",
		contract_id: "SP1.contract",
		payload: { topic: "print", value: { hex: rawValue } },
	} as unknown as StreamsEvent;
}

describe("printPayloadFromStored", () => {
	for (const rawValue of RAW_VALUES) {
		test(`legacy string, legacy object and bytes rebuild identical JSON for ${rawValue.slice(0, 12)}`, () => {
			const decoded = decodePrint(printEvent(rawValue)).decoded_payload.payload;
			const fromString = printPayloadFromStored({
				payload: JSON.stringify(decoded),
				raw_value: null,
			});
			const fromObject = printPayloadFromStored({
				payload: decoded,
				raw_value: null,
			});
			const fromBytes = printPayloadFromStored({
				payload: null,
				raw_value: printRawValueBytes(rawValue),
			});
			expect(fromString).not.toBeNull();
			expect(JSON.stringify(fromObject)).toBe(JSON.stringify(fromString));
			expect(JSON.stringify(fromBytes)).toBe(JSON.stringify(fromString));
		});
	}

	test("bytes form keeps key order topic, value, raw_value", () => {
		const rebuilt = printPayloadFromStored({
			payload: null,
			raw_value: printRawValueBytes(RAW_VALUES[0] ?? null),
		});
		expect(Object.keys(rebuilt ?? {})).toEqual(["topic", "value", "raw_value"]);
	});

	test("no bytes and no payload rebuilds null", () => {
		expect(printPayloadFromStored({ payload: null, raw_value: null })).toBe(
			null,
		);
	});

	test("an unparseable legacy string rebuilds null", () => {
		expect(
			printPayloadFromStored({ payload: "not-json{", raw_value: null }),
		).toBe(null);
	});
});

describe("printRawValueBytes", () => {
	test("hex that would not round-trip is not bytes", () => {
		expect(printRawValueBytes("0c00")).toBeNull();
		expect(printRawValueBytes("0x0C00")).toBeNull();
		expect(printRawValueBytes("0x0c0")).toBeNull();
		expect(printRawValueBytes("0x")).toBeNull();
		expect(printRawValueBytes(null)).toBeNull();
	});

	test("0x hex becomes the same bytes", () => {
		expect(printRawValueBytes("0x0c00")?.toString("hex")).toBe("0c00");
	});
});
