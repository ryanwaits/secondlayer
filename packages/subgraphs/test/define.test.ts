import { expect, test } from "bun:test";
import { defineSubgraph } from "../src/define.ts";
import type { SubgraphDefinition } from "../src/types.ts";

test("defineSubgraph returns the same definition", () => {
	const def: SubgraphDefinition = {
		name: "test-subgraph",
		sources: { transfer: { type: "ft_transfer", assetIdentifier: "SP000::my-contract" } },
		schema: {
			transfers: {
				columns: {
					sender: { type: "principal" },
					amount: { type: "uint", indexed: true },
				},
			},
		},
		handlers: { transfer: async () => {} },
	};

	const result = defineSubgraph(def);
	expect(result).toBe(def);
	expect(result.name).toBe("test-subgraph");
	expect(result.schema.transfers?.columns.amount?.type).toBe("uint");
});

test("defineSubgraph preserves optional fields", () => {
	const def = defineSubgraph({
		name: "versioned",
		version: "2.0.0",
		description: "A test subgraph",
		sources: { handler: { type: "contract_call", contractId: "SP000::contract" } },
		schema: {
			data: { columns: { value: { type: "text" } } },
		},
		handlers: { handler: () => {} },
	});

	expect(def.version).toBe("2.0.0");
	expect(def.description).toBe("A test subgraph");
});

test("defineSubgraph supports multiple tables", () => {
	const def = defineSubgraph({
		name: "marketplace",
		sources: { handler: { type: "contract_call", contractId: "SP000::nft-marketplace" } },
		schema: {
			listings: {
				columns: {
					nftId: { type: "text", indexed: true },
					seller: { type: "principal" },
					price: { type: "uint" },
				},
				indexes: [["seller", "nftId"]],
			},
			sales: {
				columns: {
					nftId: { type: "text" },
					buyer: { type: "principal" },
					price: { type: "uint" },
				},
			},
		},
		handlers: { handler: async () => {} },
	});

	expect(Object.keys(def.schema)).toEqual(["listings", "sales"]);
	expect(def.schema.listings?.indexes).toEqual([["seller", "nftId"]]);
});

test("defineSubgraph supports multiple sources with keyed handlers", () => {
	const def = defineSubgraph({
		name: "multi-source",
		sources: {
			listing: { type: "ft_transfer", assetIdentifier: "SP000::marketplace" },
			sale: { type: "ft_transfer", assetIdentifier: "SP000::marketplace" },
			stx: { type: "stx_transfer" },
		},
		schema: {
			data: { columns: { value: { type: "text" } } },
		},
		handlers: {
			listing: async () => {},
			sale: async () => {},
			stx: async () => {},
		},
	});

	expect(Object.keys(def.sources).length).toBe(3);
	expect(Object.keys(def.handlers).length).toBe(3);
});
