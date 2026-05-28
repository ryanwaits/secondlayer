import { describe, expect, test } from "bun:test";
import { matchSources } from "../src/runtime/source-matcher.ts";
import type { SubgraphFilter } from "../src/types.ts";

// B4: trait-scoped sources resolve to a contract-id set (injected as data) and
// match by asset-identifier contract prefix (tokens) or tx.contract_id (calls).

const txs = [
	{
		tx_id: "tx1",
		type: "contract_call",
		sender: "SP9",
		status: "success",
		contract_id: "SPA.token-a",
		function_name: "transfer",
	},
	{
		tx_id: "tx2",
		type: "contract_call",
		sender: "SP9",
		status: "success",
		contract_id: "SPC.not-a-token",
		function_name: "do-thing",
	},
];

const events = [
	{
		id: "e1",
		tx_id: "tx1",
		type: "ft_transfer_event",
		event_index: 0,
		data: {
			asset_identifier: "SPA.token-a::a",
			sender: "SP9",
			recipient: "SP8",
			amount: "5",
		},
	},
	{
		id: "e2",
		tx_id: "tx2",
		type: "ft_transfer_event",
		event_index: 0,
		data: {
			asset_identifier: "SPB.token-b::b",
			sender: "SP9",
			recipient: "SP8",
			amount: "9",
		},
	},
];

// Only token-a is classified SIP-010.
const traitContracts = new Map<string, ReadonlySet<string>>([
	["sip-010", new Set(["SPA.token-a"])],
]);

describe("trait-scoped sources", () => {
	test("ft_transfer trait matches only conforming contracts (by asset prefix)", () => {
		const sources: Record<string, SubgraphFilter> = {
			tokens: { type: "ft_transfer", trait: "sip-010" },
		};
		const matched = matchSources(sources, txs, events, traitContracts);
		const assets = matched.flatMap((m) =>
			m.events.map(
				(e) => (e.data as { asset_identifier: string }).asset_identifier,
			),
		);
		expect(assets).toEqual(["SPA.token-a::a"]); // token-b excluded
	});

	test("contract_call trait matches only conforming contract_id", () => {
		const sources: Record<string, SubgraphFilter> = {
			calls: { type: "contract_call", trait: "sip-010" },
		};
		const matched = matchSources(sources, txs, events, traitContracts);
		expect(matched.map((m) => m.tx.contract_id)).toEqual(["SPA.token-a"]);
	});

	test("unresolved trait (empty set) matches nothing", () => {
		const sources: Record<string, SubgraphFilter> = {
			tokens: { type: "ft_transfer", trait: "sip-013" },
		};
		expect(matchSources(sources, txs, events, traitContracts)).toEqual([]);
	});

	test("no trait → unchanged (matches all, regardless of registry)", () => {
		const sources: Record<string, SubgraphFilter> = {
			tokens: { type: "ft_transfer" },
		};
		const matched = matchSources(sources, txs, events, traitContracts);
		expect(matched.length).toBe(2);
	});

	test("trait + explicit assetIdentifier compose (AND)", () => {
		const sources: Record<string, SubgraphFilter> = {
			tokens: {
				type: "ft_transfer",
				trait: "sip-010",
				assetIdentifier: "SPB.*", // would match token-b, but trait excludes it
			},
		};
		expect(matchSources(sources, txs, events, traitContracts)).toEqual([]);
	});
});
