import { expect, test } from "bun:test";
import { defineSubgraph } from "../src/define.ts";
import type { SubgraphDefinition } from "../src/types.ts";

test("defineSubgraph returns the same definition", () => {
	const def: SubgraphDefinition = {
		name: "test-subgraph",
		sources: [{ contract: "SP000::my-contract", event: "transfer" }],
		schema: {
			transfers: {
				columns: {
					sender: { type: "principal" },
					amount: { type: "uint", indexed: true },
				},
			},
		},
		handlers: { "*": async () => {} },
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
		sources: [{ contract: "SP000::contract" }],
		schema: {
			data: { columns: { value: { type: "text" } } },
		},
		handlers: { "*": () => {} },
	});

	expect(def.version).toBe("2.0.0");
	expect(def.description).toBe("A test subgraph");
});

test("defineSubgraph supports multiple tables", () => {
	const def = defineSubgraph({
		name: "marketplace",
		sources: [{ contract: "SP000::nft-marketplace" }],
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
		handlers: { "*": async () => {} },
	});

	expect(Object.keys(def.schema)).toEqual(["listings", "sales"]);
	expect(def.schema.listings?.indexes).toEqual([["seller", "nftId"]]);
});

test("defineSubgraph supports multiple sources with keyed handlers", () => {
	const def = defineSubgraph({
		name: "multi-source",
		sources: [
			{ contract: "SP000::marketplace", event: "listing" },
			{ contract: "SP000::marketplace", event: "sale" },
			{ type: "stx_transfer" },
		],
		schema: {
			data: { columns: { value: { type: "text" } } },
		},
		handlers: {
			"SP000::marketplace::listing": async () => {},
			"SP000::marketplace::sale": async () => {},
			stx_transfer: async () => {},
		},
	});

	expect(def.sources.length).toBe(3);
	expect(Object.keys(def.handlers).length).toBe(3);
});
