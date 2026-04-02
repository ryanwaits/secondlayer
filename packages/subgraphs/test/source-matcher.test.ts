import { describe, expect, test } from "bun:test";
import { matchSources } from "../src/runtime/source-matcher.ts";
import type { SubgraphFilter } from "../src/types.ts";

// ── Test fixtures ───────────────────────────────────────────────────

const txs = [
	{
		tx_id: "tx1",
		type: "contract_call",
		sender: "SP1",
		status: "success",
		contract_id: "SP000.nft-marketplace",
		function_name: "list-item",
	},
	{
		tx_id: "tx2",
		type: "contract_call",
		sender: "SP2",
		status: "success",
		contract_id: "SP000.token",
		function_name: "transfer",
	},
	{
		tx_id: "tx3",
		type: "token_transfer",
		sender: "SP3",
		status: "success",
		contract_id: null,
		function_name: null,
	},
	{
		tx_id: "tx4",
		type: "smart_contract",
		sender: "SP4",
		status: "success",
		contract_id: "SP4.my-contract",
		function_name: null,
	},
];

const events = [
	{
		id: "e1",
		tx_id: "tx1",
		type: "smart_contract_event",
		event_index: 0,
		data: {
			contract_identifier: "SP000.nft-marketplace",
			topic: "print",
			value: "0x01",
		},
	},
	{
		id: "e2",
		tx_id: "tx1",
		type: "nft_transfer_event",
		event_index: 1,
		data: {
			asset_identifier: "SP000.nft-marketplace::nft",
			sender: "SP1",
			recipient: "SP5",
		},
	},
	{
		id: "e3",
		tx_id: "tx2",
		type: "ft_transfer_event",
		event_index: 0,
		data: {
			asset_identifier: "SP000.token::my-token",
			sender: "SP2",
			recipient: "SP6",
			amount: "1000",
		},
	},
	{
		id: "e4",
		tx_id: "tx3",
		type: "stx_transfer_event",
		event_index: 0,
		data: { sender: "SP3", recipient: "SP7", amount: "5000000" },
	},
	{
		id: "e5",
		tx_id: "tx2",
		type: "ft_mint_event",
		event_index: 1,
		data: {
			asset_identifier: "SP000.token::my-token",
			recipient: "SP2",
			amount: "500",
		},
	},
	{
		id: "e6",
		tx_id: "tx2",
		type: "ft_burn_event",
		event_index: 2,
		data: {
			asset_identifier: "SP000.token::my-token",
			sender: "SP2",
			amount: "100",
		},
	},
];

// ── Tests ───────────────────────────────────────────────────────────

describe("matchSources", () => {
	// ── Contract call filters ──

	test("matches contract_call by contractId", () => {
		const sources: Record<string, SubgraphFilter> = {
			listing: {
				type: "contract_call",
				contractId: "SP000.nft-marketplace",
			},
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(1);
		expect(matched[0]!.tx.tx_id).toBe("tx1");
		expect(matched[0]!.sourceName).toBe("listing");
	});

	test("matches contract_call by contractId + functionName", () => {
		const sources: Record<string, SubgraphFilter> = {
			list: {
				type: "contract_call",
				contractId: "SP000.nft-marketplace",
				functionName: "list-item",
			},
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(1);
		expect(matched[0]!.tx.function_name).toBe("list-item");
	});

	test("filters out non-matching function name", () => {
		const sources: Record<string, SubgraphFilter> = {
			buy: {
				type: "contract_call",
				contractId: "SP000.nft-marketplace",
				functionName: "buy-item",
			},
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(0);
	});

	test("matches contract_call with wildcard contractId", () => {
		const sources: Record<string, SubgraphFilter> = {
			all: { type: "contract_call", contractId: "SP000.*" },
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(2); // tx1 and tx2
	});

	test("matches contract_call by caller", () => {
		const sources: Record<string, SubgraphFilter> = {
			fromSP1: {
				type: "contract_call",
				contractId: "SP000.nft-marketplace",
				caller: "SP1",
			},
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(1);
	});

	// ── Contract deploy filters ──

	test("matches contract_deploy", () => {
		const sources: Record<string, SubgraphFilter> = {
			deploy: { type: "contract_deploy" },
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(1);
		expect(matched[0]!.tx.tx_id).toBe("tx4");
		expect(matched[0]!.sourceName).toBe("deploy");
	});

	test("matches contract_deploy by deployer", () => {
		const sources: Record<string, SubgraphFilter> = {
			deploy: { type: "contract_deploy", deployer: "SP4" },
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(1);
	});

	test("matches contract_deploy by contractName", () => {
		const sources: Record<string, SubgraphFilter> = {
			deploy: { type: "contract_deploy", contractName: "my-contract" },
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(1);
	});

	test("filters contract_deploy by wrong deployer", () => {
		const sources: Record<string, SubgraphFilter> = {
			deploy: { type: "contract_deploy", deployer: "SP999" },
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(0);
	});

	// ── FT event filters ──

	test("matches ft_transfer by assetIdentifier", () => {
		const sources: Record<string, SubgraphFilter> = {
			transfer: {
				type: "ft_transfer",
				assetIdentifier: "SP000.token::my-token",
			},
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(1);
		expect(matched[0]!.tx.tx_id).toBe("tx2");
		expect(matched[0]!.events.length).toBe(1);
		expect(matched[0]!.events[0]!.type).toBe("ft_transfer_event");
	});

	test("matches ft_mint by assetIdentifier", () => {
		const sources: Record<string, SubgraphFilter> = {
			mint: {
				type: "ft_mint",
				assetIdentifier: "SP000.token::my-token",
			},
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(1);
		expect(matched[0]!.events[0]!.type).toBe("ft_mint_event");
	});

	test("matches ft_burn by assetIdentifier", () => {
		const sources: Record<string, SubgraphFilter> = {
			burn: {
				type: "ft_burn",
				assetIdentifier: "SP000.token::my-token",
			},
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(1);
		expect(matched[0]!.events[0]!.type).toBe("ft_burn_event");
	});

	test("matches ft_transfer with wildcard assetIdentifier", () => {
		const sources: Record<string, SubgraphFilter> = {
			allTransfers: {
				type: "ft_transfer",
				assetIdentifier: "SP000.*::*",
			},
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(1);
	});

	test("matches ft_transfer with minAmount filter", () => {
		const sources: Record<string, SubgraphFilter> = {
			big: {
				type: "ft_transfer",
				assetIdentifier: "SP000.token::my-token",
				minAmount: 500n,
			},
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(1); // amount 1000 >= 500

		const tooHigh: Record<string, SubgraphFilter> = {
			huge: {
				type: "ft_transfer",
				assetIdentifier: "SP000.token::my-token",
				minAmount: 5000n,
			},
		};
		const none = matchSources(tooHigh, txs, events);
		expect(none.length).toBe(0); // amount 1000 < 5000
	});

	test("matches ft_transfer without assetIdentifier (chain-wide)", () => {
		const sources: Record<string, SubgraphFilter> = {
			allFt: { type: "ft_transfer" },
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(1); // e3 matches
	});

	// ── NFT event filters ──

	test("matches nft_transfer by assetIdentifier", () => {
		const sources: Record<string, SubgraphFilter> = {
			nft: {
				type: "nft_transfer",
				assetIdentifier: "SP000.nft-marketplace::nft",
			},
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(1);
		expect(matched[0]!.events[0]!.type).toBe("nft_transfer_event");
	});

	// ── STX event filters ──

	test("matches stx_transfer", () => {
		const sources: Record<string, SubgraphFilter> = {
			stx: { type: "stx_transfer" },
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(1);
		expect(matched[0]!.tx.tx_id).toBe("tx3");
	});

	test("matches stx_transfer with minAmount", () => {
		const sources: Record<string, SubgraphFilter> = {
			whale: { type: "stx_transfer", minAmount: 1000000n },
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(1); // 5000000 >= 1000000

		const tooHigh: Record<string, SubgraphFilter> = {
			mega: { type: "stx_transfer", minAmount: 10000000n },
		};
		const none = matchSources(tooHigh, txs, events);
		expect(none.length).toBe(0);
	});

	test("matches stx_transfer with sender filter", () => {
		const sources: Record<string, SubgraphFilter> = {
			fromSP3: { type: "stx_transfer", sender: "SP3" },
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(1);
	});

	// ── Print event filters ──

	test("matches print_event by contractId", () => {
		const sources: Record<string, SubgraphFilter> = {
			prints: {
				type: "print_event",
				contractId: "SP000.nft-marketplace",
			},
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(1);
		expect(matched[0]!.events.length).toBe(1);
		expect(matched[0]!.events[0]!.type).toBe("smart_contract_event");
	});

	test("matches print_event with wildcard contractId", () => {
		const sources: Record<string, SubgraphFilter> = {
			allPrints: { type: "print_event", contractId: "SP000.*" },
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(1);
	});

	test("filters print_event by wrong contractId", () => {
		const sources: Record<string, SubgraphFilter> = {
			wrong: { type: "print_event", contractId: "SP999.unknown" },
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(0);
	});

	// ── Multi-source ──

	test("matches multiple named sources", () => {
		const sources: Record<string, SubgraphFilter> = {
			calls: { type: "contract_call", contractId: "SP000.nft-marketplace" },
			deploys: { type: "contract_deploy" },
			stx: { type: "stx_transfer" },
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(3);
		const names = matched.map((m) => m.sourceName).sort();
		expect(names).toEqual(["calls", "deploys", "stx"]);
	});

	test("deduplicates by tx_id + sourceName", () => {
		const sources: Record<string, SubgraphFilter> = {
			a: { type: "contract_call", contractId: "SP000.nft-marketplace" },
			b: { type: "contract_call", contractId: "SP000.nft-marketplace" },
		};
		const matched = matchSources(sources, txs, events);
		// Same tx matched by two different source names — both kept (different sourceName)
		expect(matched.length).toBe(2);
		expect(matched[0]!.sourceName).toBe("a");
		expect(matched[1]!.sourceName).toBe("b");
	});

	test("returns empty for no matches", () => {
		const sources: Record<string, SubgraphFilter> = {
			nothing: { type: "contract_call", contractId: "SP999.unknown" },
		};
		const matched = matchSources(sources, txs, events);
		expect(matched.length).toBe(0);
	});
});
