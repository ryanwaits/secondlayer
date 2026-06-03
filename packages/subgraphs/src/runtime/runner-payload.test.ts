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
