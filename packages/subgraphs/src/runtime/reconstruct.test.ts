import { describe, expect, test } from "bun:test";
import type { Event } from "@secondlayer/shared/db";
import type { SubgraphFilter } from "../types.ts";
import {
	type IndexBlockRow,
	type IndexEventRow,
	type IndexTransactionRow,
	reconstructBlock,
	reconstructEvent,
	reconstructTransaction,
} from "./reconstruct.ts";
import { buildEventPayload } from "./runner.ts";
import type { MatchedTx } from "./source-matcher.ts";

const tx = {
	tx_id: "0xtx",
	type: "contract_call",
	sender: "SP000000000000000000002Q6VF78",
	status: "success",
	contract_id: null,
	function_name: null,
	function_args: [],
	raw_result: null,
} as unknown as MatchedTx["tx"];

// Build the handler payload the way the runtime does, from a raw node event row.
function payloadFrom(
	filterType: string,
	rawEvent: Partial<Event>,
): Record<string, unknown> {
	return buildEventPayload(
		{ type: filterType } as SubgraphFilter,
		tx,
		rawEvent as MatchedTx["events"][0],
	);
}

describe("reconstructBlock", () => {
	test("maps Index block + converts ISO block_time → unix seconds", () => {
		const idx: IndexBlockRow = {
			block_height: 8100000,
			block_hash: "0xhash",
			parent_hash: "0xparent",
			burn_block_height: 900000,
			burn_block_hash: "0xburn",
			block_time: "2026-05-27T04:04:04.000Z",
		};
		const block = reconstructBlock(idx);
		expect(block.height).toBe(8100000);
		expect(block.hash).toBe("0xhash");
		expect(block.burn_block_height).toBe(900000);
		expect(block.canonical).toBe(true);
		expect(block.timestamp).toBe(
			Math.floor(Date.parse(idx.block_time as string) / 1000),
		);
	});
});

describe("reconstructEvent → handler-payload parity with the raw node row", () => {
	// Clarity uint 223. Real values from prod block 8100001 (flap-badges mint).
	const NFT_HEX = "0x01000000000000000000000000000000df";

	test("nft_mint: same tokenId from Index hex as from the raw node event", () => {
		const indexRow: IndexEventRow = {
			event_type: "nft_mint",
			block_height: 8100001,
			tx_id: "0xtx",
			event_index: 1,
			contract_id: "SP31DP8F8CF2GXSZBHHHK5J6Y061744E1TNFGYWYV.flap-badges",
			asset_identifier:
				"SP31DP8F8CF2GXSZBHHHK5J6Y061744E1TNFGYWYV.flap-badges::flap-badge",
			recipient: "SP21G4FA7NS9YXEH2B4X8B642ZSVP7J8RB6DEVK2Y",
			value: NFT_HEX,
		};
		const rawRow: Partial<Event> = {
			type: "nft_mint_event",
			data: {
				value: { UInt: 223 }, // node serde-tagged form (DB tap only)
				raw_value: NFT_HEX,
				recipient: "SP21G4FA7NS9YXEH2B4X8B642ZSVP7J8RB6DEVK2Y",
				asset_identifier:
					"SP31DP8F8CF2GXSZBHHHK5J6Y061744E1TNFGYWYV.flap-badges::flap-badge",
			},
		};
		const fromIndex = payloadFrom("nft_mint", reconstructEvent(indexRow));
		const fromRaw = payloadFrom("nft_mint", rawRow);
		expect(fromIndex.tokenId).toBe(223n);
		expect(fromIndex).toEqual(fromRaw);
	});

	test("ft_transfer: identical payload", () => {
		const indexRow: IndexEventRow = {
			event_type: "ft_transfer",
			block_height: 8100000,
			tx_id: "0xtx",
			event_index: 0,
			contract_id: "SP1AY6K3PQV5MRT6R4S671NWW2FRVPKM0BR162CT6.leo-token",
			asset_identifier:
				"SP1AY6K3PQV5MRT6R4S671NWW2FRVPKM0BR162CT6.leo-token::leo",
			sender: "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM",
			recipient: "SP3302FFJJ31J312AHHH017AD53WC724JH0QRDYX7",
			amount: "181703642088",
		};
		const rawRow: Partial<Event> = {
			type: "ft_transfer_event",
			data: {
				amount: "181703642088",
				sender: "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM",
				recipient: "SP3302FFJJ31J312AHHH017AD53WC724JH0QRDYX7",
				asset_identifier:
					"SP1AY6K3PQV5MRT6R4S671NWW2FRVPKM0BR162CT6.leo-token::leo",
			},
		};
		expect(payloadFrom("ft_transfer", reconstructEvent(indexRow))).toEqual(
			payloadFrom("ft_transfer", rawRow),
		);
	});

	test("contract_call: same payload from Index function_args_hex as from the raw tx", () => {
		const argsHex = ["0x0100000000000000000000000000000001"]; // Clarity uint 1
		const indexTx: IndexTransactionRow = {
			tx_id: "0xc",
			block_height: 1,
			tx_index: 0,
			tx_type: "contract_call",
			sender: "SP1",
			status: "success",
			contract_call: {
				contract_id: "SP.c",
				function_name: "transfer",
				function_args_hex: argsHex,
				result_hex: "0x07",
			},
		};
		const rawTx = {
			tx_id: "0xc",
			type: "contract_call",
			sender: "SP1",
			status: "success",
			contract_id: "SP.c",
			function_name: "transfer",
			function_args: argsHex,
			raw_result: "0x07",
		} as unknown as MatchedTx["tx"];
		const filter = { type: "contract_call" } as SubgraphFilter;
		const fromIndex = buildEventPayload(
			filter,
			reconstructTransaction(indexTx) as unknown as MatchedTx["tx"],
			null,
		);
		const fromRaw = buildEventPayload(filter, rawTx, null);
		expect(fromIndex).toEqual(fromRaw);
	});

	test("print: same data (driven by raw_value hex, not the tagged value)", () => {
		const RAW =
			"0x0c00000003056576656e740d00000005766f74656406706f742d696401000000000000000000000000000000030377686f05162e10d9f69b67159e3d6f4c6da073ed8fb5860707";
		const indexRow: IndexEventRow = {
			event_type: "print",
			block_height: 8100000,
			tx_id: "0xtx",
			event_index: 0,
			contract_id: "SP31DP8F8CF2GXSZBHHHK5J6Y061744E1TNFGYWYV.pot-pinboard",
			payload: {
				topic: "print",
				value: { event: "voted", "pot-id": "3", who: "SPQ..." },
				raw_value: RAW,
			},
		};
		const rawRow: Partial<Event> = {
			type: "contract_event",
			data: {
				topic: "print",
				contract_identifier:
					"SP31DP8F8CF2GXSZBHHHK5J6Y061744E1TNFGYWYV.pot-pinboard",
				value: {
					Tuple: {
						/* node serde-tagged, ignored by runner */
					},
				},
				raw_value: RAW,
			},
		};
		expect(payloadFrom("print_event", reconstructEvent(indexRow))).toEqual(
			payloadFrom("print_event", rawRow),
		);
	});
});
