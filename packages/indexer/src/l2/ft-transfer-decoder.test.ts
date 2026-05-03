import { describe, expect, test } from "bun:test";
import type { StreamsEvent } from "../streams-events.ts";
import { decodeFtTransfer } from "./ft-transfer-decoder.ts";

function ftTransfer(payload: Record<string, unknown>): StreamsEvent {
	return {
		cursor: "123:4",
		block_height: 123,
		index_block_hash: "0x01",
		burn_block_height: 456,
		tx_id: "0xtx",
		tx_index: 2,
		event_index: 4,
		event_type: "ft_transfer",
		contract_id: "SP1.token",
		payload,
		ts: "2026-05-02T21:43:00.000Z",
	};
}

describe("decodeFtTransfer", () => {
	test("maps Streams payload to decoded ft_transfer shape", () => {
		const decoded = decodeFtTransfer(
			ftTransfer({
				asset_identifier: "SP1.token::sbtc",
				sender: "SP1",
				recipient: "SP2",
				amount: "250000",
			}),
		);

		expect(decoded).toEqual({
			cursor: "123:4",
			block_height: 123,
			tx_id: "0xtx",
			tx_index: 2,
			event_index: 4,
			event_type: "ft_transfer",
			source_cursor: "123:4",
			decoded_payload: {
				asset_identifier: "SP1.token::sbtc",
				contract_id: "SP1.token",
				token_name: "sbtc",
				sender: "SP1",
				recipient: "SP2",
				amount: "250000",
			},
		});
	});

	test("rejects missing asset_identifier", () => {
		expect(() =>
			decodeFtTransfer(
				ftTransfer({
					sender: "SP1",
					recipient: "SP2",
					amount: "1",
				}),
			),
		).toThrow("missing asset_identifier");
	});

	test("rejects malformed amount", () => {
		expect(() =>
			decodeFtTransfer(
				ftTransfer({
					asset_identifier: "SP1.token::sbtc",
					sender: "SP1",
					recipient: "SP2",
					amount: "1.5",
				}),
			),
		).toThrow("malformed amount");
	});
});
