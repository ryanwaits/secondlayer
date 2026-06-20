import { describe, expect, test } from "bun:test";
import type { IndexHttpClient } from "@secondlayer/shared/index-http";
import type { SubgraphDefinition } from "../types.ts";
import {
	PublicApiBlockSource,
	isStreamsIndexEligible,
} from "./block-source.ts";

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
	test("contract_call / contract_deploy sources → eligible (Phase 2)", () => {
		expect(
			isStreamsIndexEligible(
				def({ a: { type: "ft_transfer" }, b: { type: "contract_call" } }),
			),
		).toBe(true);
		expect(
			isStreamsIndexEligible(def({ a: { type: "contract_deploy" } })),
		).toBe(true);
	});
	test("a trait-scoped event source → eligible (registry is on the platform DB)", () => {
		expect(
			isStreamsIndexEligible(
				def({ a: { type: "ft_transfer", trait: "sip-010" } }),
			),
		).toBe(true);
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
		getIndexTip: async () => 2,
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

	test("event-only (needsTransactions=false) skips walkTransactions, synthesizes tx from joined event context", async () => {
		let txsFetched = false;
		const http = {
			walkBlocks: async () => [
				{
					block_height: 1,
					block_hash: "0xh1",
					parent_hash: "0xp1",
					burn_block_height: 5,
					burn_block_hash: null,
					block_time: "2026-01-01T00:00:00.000Z",
				},
			],
			walkTransactions: async () => {
				txsFetched = true;
				return [];
			},
			walkEvents: async (
				type: string,
				_from: number,
				_to: number,
				withTx?: boolean,
			) =>
				type === "print" && withTx
					? [
							{
								event_type: "print",
								block_height: 1,
								tx_id: "0xtx",
								tx_index: 3,
								event_index: 0,
								contract_id: "SP.reg",
								payload: {
									topic: "completed-deposit",
									value: null,
									raw_value: "0x",
								},
								tx_sender: "SPSUBMITTER",
								tx_type: "contract_call",
								tx_status: "success",
								tx_contract_id: "SP.dep",
								tx_function_name: "complete-deposit",
							},
						]
					: [],
			getIndexTip: async () => 1,
		} as unknown as IndexHttpClient;

		const src = new PublicApiBlockSource(http, ["print"], undefined, false);
		const map = await src.loadBlockRange(1, 1);

		// walkTransactions is never invoked for an event-only subgraph.
		expect(txsFetched).toBe(false);
		const b1 = map.get(1);
		expect(b1?.txs).toHaveLength(1);
		// The synthesized tx carries the real submitter from the joined context —
		// so ctx.tx.sender is correct without draining every tx in the range.
		expect(b1?.txs[0].tx_id).toBe("0xtx");
		expect(b1?.txs[0].sender).toBe("SPSUBMITTER");
		expect(b1?.txs[0].tx_index).toBe(3);
		expect(b1?.events).toHaveLength(1);
	});

	test("getTip reads the Index tip", async () => {
		const src = new PublicApiBlockSource(fakeHttp, []);
		expect(await src.getTip()).toBe(2);
	});
});
