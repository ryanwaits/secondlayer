import { describe, expect, test } from "bun:test";
import type { SubgraphDefinition } from "../types.ts";
import {
	PublicApiBlockSource,
	isStreamsIndexEligible,
} from "./block-source.ts";
import type { IndexHttpClient } from "./index-http.ts";

function def(sources: Record<string, unknown>): SubgraphDefinition {
	return { name: "t", sources } as unknown as SubgraphDefinition;
}

describe("isStreamsIndexEligible", () => {
	test("all event-type sources, no trait → eligible", () => {
		expect(
			isStreamsIndexEligible(
				def({ a: { type: "ft_transfer" }, b: { type: "nft_mint" } }),
			),
		).toBe(true);
	});
	test("a contract_call source → ineligible (Phase 2)", () => {
		expect(
			isStreamsIndexEligible(
				def({ a: { type: "ft_transfer" }, b: { type: "contract_call" } }),
			),
		).toBe(false);
	});
	test("a trait-scoped event source → ineligible (Phase 2)", () => {
		expect(
			isStreamsIndexEligible(
				def({ a: { type: "ft_transfer", trait: "sip-010" } }),
			),
		).toBe(false);
	});
	test("array-style sources → ineligible (filterless * leak)", () => {
		const d = {
			name: "t",
			sources: [{ type: "ft_transfer" }],
		} as unknown as SubgraphDefinition;
		expect(isStreamsIndexEligible(d)).toBe(false);
	});
});

describe("PublicApiBlockSource.loadBlockRange", () => {
	const fakeHttp = {
		walkBlocks: async () => [
			{
				block_height: 1,
				block_hash: "0xh1",
				parent_hash: "0xp1",
				burn_block_height: 5,
				burn_block_hash: null,
				block_time: "2026-01-01T00:00:00.000Z",
			},
			{
				block_height: 2, // empty block
				block_hash: "0xh2",
				parent_hash: "0xh1",
				burn_block_height: 6,
				burn_block_hash: null,
				block_time: "2026-01-01T00:01:00.000Z",
			},
		],
		walkTransactions: async () => [
			{
				tx_id: "0xt1",
				block_height: 1,
				tx_index: 0,
				tx_type: "contract_call",
				sender: "SP1",
				status: "success",
				contract_call: { contract_id: "SP.c", function_name: "f" },
			},
		],
		walkEvents: async (type: string) =>
			type === "ft_transfer"
				? [
						{
							event_type: "ft_transfer",
							block_height: 1,
							tx_id: "0xt1",
							event_index: 0,
							contract_id: "SP.c",
							asset_identifier: "SP.c::a",
							sender: "SP1",
							recipient: "SP2",
							amount: "100",
						},
					]
				: [],
		getTip: async () => 2,
	} as unknown as IndexHttpClient;

	test("assembles canonical BlockData incl. empty blocks, txs, events", async () => {
		const src = new PublicApiBlockSource(fakeHttp, ["ft_transfer"]);
		const map = await src.loadBlockRange(1, 2);

		expect([...map.keys()].sort()).toEqual([1, 2]);
		const b1 = map.get(1);
		expect(b1?.block.height).toBe(1);
		expect(b1?.block.timestamp).toBe(
			Math.floor(Date.parse("2026-01-01T00:00:00.000Z") / 1000),
		);
		expect(b1?.txs).toHaveLength(1);
		expect(b1?.txs[0].tx_id).toBe("0xt1");
		expect(b1?.txs[0].type).toBe("contract_call");
		expect(b1?.txs[0].contract_id).toBe("SP.c");
		expect(b1?.events).toHaveLength(1);
		expect(b1?.events[0].type).toBe("ft_transfer_event");

		// Empty block present (not a gap).
		expect(map.get(2)?.events).toHaveLength(0);
		expect(map.get(2)?.txs).toHaveLength(0);
	});

	test("getTip reads the Streams clock", async () => {
		const src = new PublicApiBlockSource(fakeHttp, []);
		expect(await src.getTip()).toBe(2);
	});
});
