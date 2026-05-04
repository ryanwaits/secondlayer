import { describe, expect, test } from "bun:test";
import { decodeNftTransfer, isNftTransfer } from "../streams/nft-transfer.ts";
import type { StreamsEvent } from "../streams/types.ts";

const EVENT: StreamsEvent = {
	cursor: "1:0",
	block_height: 1,
	index_block_hash: "0x01",
	burn_block_height: 101,
	tx_id: "0xtx",
	tx_index: 0,
	event_index: 0,
	event_type: "nft_transfer",
	contract_id: "SP1.collection",
	payload: {
		asset_identifier: "SP1.collection::token",
		sender: "SP1",
		recipient: "SP2",
		value: "0x0100000000000000000000000000000001",
	},
	ts: "2026-05-04T00:00:00.000Z",
};

describe("nft_transfer helpers", () => {
	test("narrows nft_transfer events", () => {
		expect(isNftTransfer(EVENT)).toBe(true);
		expect(isNftTransfer({ ...EVENT, event_type: "ft_transfer" })).toBe(false);
	});

	test("maps Streams payload to decoded nft_transfer shape", () => {
		expect(decodeNftTransfer(EVENT)).toEqual({
			cursor: "1:0",
			block_height: 1,
			tx_id: "0xtx",
			tx_index: 0,
			event_index: 0,
			event_type: "nft_transfer",
			decoded_payload: {
				asset_identifier: "SP1.collection::token",
				contract_id: "SP1.collection",
				token_name: "token",
				sender: "SP1",
				recipient: "SP2",
				value: "0x0100000000000000000000000000000001",
			},
			source_cursor: "1:0",
		});
	});

	test("accepts Hiro value objects with hex", () => {
		const decoded = decodeNftTransfer({
			...EVENT,
			payload: {
				...EVENT.payload,
				value: { hex: "0x01" },
			},
		});

		expect(decoded.decoded_payload.value).toBe("0x01");
	});

	test("rejects malformed values", () => {
		expect(() =>
			decodeNftTransfer({
				...EVENT,
				payload: { ...EVENT.payload, value: "u1" },
			}),
		).toThrow("malformed value");
	});
});
