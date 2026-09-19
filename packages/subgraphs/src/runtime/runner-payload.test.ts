import { describe, expect, test } from "bun:test";
import type { SubgraphFilter } from "../types.ts";
import { buildEventPayload } from "./runner.ts";
import type { MatchedTx } from "./source-matcher.ts";

// Clarity uint 223, hex-serialized — the canonical `raw_value` an nft event
// carries on both the DB tap and the Index API.
const NFT_HEX = "0x01000000000000000000000000000000df";

const tx = {
	tx_id: "0xabc",
	type: "contract_call",
	sender: "SP000000000000000000002Q6VF78",
	status: "success",
	contract_id: null,
	function_name: null,
	function_args: [],
	raw_result: null,
} as unknown as MatchedTx["tx"];

function nftEvent(withRawValue: boolean): MatchedTx["events"][0] {
	const data: Record<string, unknown> = {
		// Node serde-tagged form, only present via the DB tap:
		value: { UInt: 223 },
		recipient: "SP21G4FA7NS9YXEH2B4X8B642ZSVP7J8RB6DEVK2Y",
		asset_identifier: "SP000000000000000000002Q6VF78.x::y",
	};
	if (withRawValue) data.raw_value = NFT_HEX;
	return {
		type: "nft_mint_event",
		event_index: 0,
		tx_id: "0xabc",
		id: "e1",
		block_height: 1,
		data,
	} as unknown as MatchedTx["events"][0];
}

describe("buildEventPayload nft tokenId", () => {
	const filter = { type: "nft_mint" } as SubgraphFilter;

	test("decodes tokenId from canonical hex (raw_value), not the serde-tagged value", () => {
		const payload = buildEventPayload(filter, tx, nftEvent(true));
		// cvToValue(uint) → bigint; source-independent + clean.
		expect(payload.tokenId).toBe(223n);
		expect(payload.tokenId).not.toEqual({ UInt: 223 });
	});

	test("falls back to value when raw_value is absent", () => {
		const payload = buildEventPayload(filter, tx, nftEvent(false));
		expect(payload.tokenId).toEqual({ UInt: 223 });
	});
});

describe("buildEventPayload print contractId", () => {
	const filter = { type: "print_event" } as SubgraphFilter;

	test("falls back to data.contract_id when contract_identifier is absent", () => {
		const payload = buildEventPayload(filter, tx, {
			type: "contract_event",
			event_index: 0,
			tx_id: tx.tx_id,
			id: "e1",
			data: {
				topic: "print",
				contract_id: "SP.foo",
			},
		} as unknown as MatchedTx["events"][0]);
		expect(payload.contractId).toBe("SP.foo");
	});

	test("prefers contract_identifier over contract_id", () => {
		const payload = buildEventPayload(filter, tx, {
			type: "smart_contract_event",
			event_index: 0,
			tx_id: tx.tx_id,
			id: "e1",
			data: {
				topic: "print",
				contract_identifier: "SP.legacy",
				contract_id: "SP.current",
			},
		} as unknown as MatchedTx["events"][0]);
		expect(payload.contractId).toBe("SP.legacy");
	});
});

describe("buildEventPayload VM traces preserve raw hex", () => {
	const uintHex = "0x0100000000000000000000000000000001";
	const boolHex = "0x03";

	test("map_set keeps raw_key/raw_value as strings regardless of hex length", () => {
		const payload = buildEventPayload(
			{ type: "map_set" } as SubgraphFilter,
			tx,
			{
				type: "map_set",
				event_index: 3,
				tx_id: tx.tx_id,
				id: "vm1",
				data: {
					contract_identifier: "SP.store",
					map_name: "store",
					raw_key: uintHex,
					raw_value: boolHex,
				},
			} as unknown as MatchedTx["events"][0],
		);
		expect(payload.rawKey).toBe(uintHex);
		expect(payload.rawValue).toBe(boolHex);
		expect(typeof payload.rawKey).toBe("string");
		expect(typeof payload.rawValue).toBe("string");
		expect(payload.key).toBe(1n);
		expect(payload.map).toBe("store");
	});

	test("nested_contract_call keeps arguments and rawResult as hex", () => {
		const payload = buildEventPayload(
			{ type: "nested_contract_call" } as SubgraphFilter,
			tx,
			{
				type: "nested_contract_call",
				event_index: 0,
				tx_id: tx.tx_id,
				id: "vm0",
				data: {
					contract_identifier: "SP.store",
					sender: null,
					caller: "SP.c",
					function_name: "set-value",
					function_args: [uintHex, boolHex],
					raw_result: uintHex,
				},
			} as unknown as MatchedTx["events"][0],
		);
		expect(payload.arguments).toEqual([uintHex, boolHex]);
		expect(payload.rawResult).toBe(uintHex);
		expect((payload.args as unknown[])[0]).toBe(1n);
		expect(payload.functionName).toBe("set-value");
		expect(payload.sender).toBeNull();
	});
});
