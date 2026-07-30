import { describe, expect, test } from "bun:test";
import type { StreamsEvent } from "../index.ts";
import { decode } from "../streams/decode.ts";

function base(event_type: string, payload: unknown): StreamsEvent {
	return {
		cursor: "5:1",
		block_height: 5,
		block_hash: "0xb",
		burn_block_height: 10,
		tx_id: "0xt",
		tx_index: 0,
		event_index: 1,
		contract_id: "SP1.token",
		ts: "2026-07-30T00:00:00.000Z",
		event_type,
		payload,
	} as StreamsEvent;
}

describe("decode(event) — one call, the Index row shape", () => {
	test("flattens every payload into the event_type-discriminated union", () => {
		const ft = decode(
			base("ft_transfer", {
				asset_identifier: "SP1.token::t",
				sender: "SP1",
				recipient: "SP2",
				amount: "42",
			}),
		);
		expect(ft).toMatchObject({
			event_type: "ft_transfer",
			cursor: "5:1",
			block_height: 5,
			asset_identifier: "SP1.token::t",
			amount: "42",
		});
		if (ft.event_type === "ft_transfer") {
			// Narrowing works exactly like an Index row.
			expect(ft.amount).toBe("42");
		}

		const lock = decode(
			base("stx_lock", {
				locked_address: "SP1",
				locked_amount: "100",
				unlock_height: "900",
			}),
		);
		expect(lock).toMatchObject({
			event_type: "stx_lock",
			sender: "SP1",
			amount: "100",
			payload: { unlock_height: "900" },
		});

		const nft = decode(
			base("nft_transfer", {
				asset_identifier: "SP1.nft::n",
				sender: "SP1",
				recipient: "SP2",
				value: { hex: "0x0100000000000000000000000000000001" },
			}),
		);
		expect(nft).toMatchObject({
			event_type: "nft_transfer",
			value: "0x0100000000000000000000000000000001",
		});

		const print = decode(
			base("print", { topic: "swap", value: { a: 1 }, raw_value: "0x0c" }),
		);
		expect(print).toMatchObject({
			event_type: "print",
			payload: { topic: "swap", value: { a: 1 }, raw_value: "0x0c" },
		});
	});

	test("malformed payloads throw with the field named — never a trusted cast", () => {
		expect(() =>
			decode(base("ft_transfer", { sender: "SP1", recipient: "SP2" })),
		).toThrow(/asset_identifier/);
		expect(() =>
			decode(base("stx_mint", { recipient: "SP2", amount: "not-a-number" })),
		).toThrow(/amount/);
	});
});
