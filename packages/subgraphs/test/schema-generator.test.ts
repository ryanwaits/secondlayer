import { expect, test } from "bun:test";
import { generateSubgraphSQL } from "../src/schema/generator.ts";
import type { SubgraphDefinition } from "../src/types.ts";

const baseDef: SubgraphDefinition = {
	name: "token-transfers",
	sources: { transfer: { type: "ft_transfer", assetIdentifier: "SP000::token" } },
	schema: {
		transfers: {
			columns: {
				sender: { type: "principal" },
				recipient: { type: "principal", indexed: true },
				amount: { type: "uint", indexed: true },
				memo: { type: "text", nullable: true },
			},
		},
	},
	handlers: { transfer: async () => {} },
};

test("generates CREATE SCHEMA statement", () => {
	const { statements } = generateSubgraphSQL(baseDef);
	expect(statements[0]).toBe(
		"CREATE SCHEMA IF NOT EXISTS subgraph_token_transfers",
	);
});

test("generates CREATE TABLE with auto-columns", () => {
	const { statements } = generateSubgraphSQL(baseDef);
	const createTable = statements[1]!;
	expect(createTable).toContain("subgraph_token_transfers.transfers");
	expect(createTable).toContain("_id BIGSERIAL PRIMARY KEY");
	expect(createTable).toContain("_block_height BIGINT NOT NULL");
	expect(createTable).toContain("_tx_id TEXT NOT NULL");
	expect(createTable).toContain(
		"_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
	);
});

test("maps column types correctly", () => {
	const { statements } = generateSubgraphSQL(baseDef);
	const createTable = statements[1]!;
	expect(createTable).toContain("sender TEXT NOT NULL");
	expect(createTable).toContain("amount NUMERIC NOT NULL");
	expect(createTable).toContain("memo TEXT"); // nullable — no NOT NULL
});

test("generates indexes for indexed columns", () => {
	const { statements } = generateSubgraphSQL(baseDef);
	const indexStatements = statements.filter((s) => s.includes("CREATE INDEX"));
	// 2 auto (block_height, tx_id) + 2 user (recipient, amount)
	expect(indexStatements.length).toBe(4);
	expect(indexStatements.some((s) => s.includes("recipient"))).toBe(true);
	expect(indexStatements.some((s) => s.includes("amount"))).toBe(true);
});

test("produces stable hash for same schema", () => {
	const { hash: hash1 } = generateSubgraphSQL(baseDef);
	const { hash: hash2 } = generateSubgraphSQL(baseDef);
	expect(hash1).toBe(hash2);
});

test("hash changes when schema changes", () => {
	const modified: SubgraphDefinition = {
		...baseDef,
		schema: {
			transfers: {
				columns: {
					...baseDef.schema.transfers!.columns,
					newcol: { type: "boolean" },
				},
			},
		},
	};
	const { hash: h1 } = generateSubgraphSQL(baseDef);
	const { hash: h2 } = generateSubgraphSQL(modified);
	expect(h1).not.toBe(h2);
});

test("converts hyphens to underscores in schema name", () => {
	const { statements } = generateSubgraphSQL(baseDef);
	expect(statements[0]).toContain("subgraph_token_transfers");
});

test("generates all column types", () => {
	const def: SubgraphDefinition = {
		name: "all-types",
		sources: { handler: { type: "contract_call", contractId: "SP::c" } },
		schema: {
			data: {
				columns: {
					a: { type: "text" },
					b: { type: "uint" },
					c: { type: "int" },
					d: { type: "principal" },
					e: { type: "boolean" },
					f: { type: "timestamp" },
					g: { type: "jsonb" },
				},
			},
		},
		handlers: { handler: () => {} },
	};
	const { statements } = generateSubgraphSQL(def);
	const table = statements[1]!;
	expect(table).toContain("a TEXT");
	expect(table).toContain("b NUMERIC");
	expect(table).toContain("c NUMERIC");
	expect(table).toContain("d TEXT");
	expect(table).toContain("e BOOLEAN");
	expect(table).toContain("f TIMESTAMPTZ");
	expect(table).toContain("g JSONB");
});

test("generates multiple tables", () => {
	const def: SubgraphDefinition = {
		name: "marketplace",
		sources: { handler: { type: "contract_call", contractId: "SP::nft" } },
		schema: {
			listings: {
				columns: { price: { type: "uint" } },
			},
			sales: {
				columns: { buyer: { type: "principal" } },
			},
		},
		handlers: { handler: () => {} },
	};
	const { statements } = generateSubgraphSQL(def);
	const creates = statements.filter((s) => s.startsWith("CREATE TABLE"));
	expect(creates.length).toBe(2);
	expect(creates[0]).toContain("subgraph_marketplace.listings");
	expect(creates[1]).toContain("subgraph_marketplace.sales");
});

test("generates composite indexes", () => {
	const def: SubgraphDefinition = {
		name: "indexed",
		sources: { handler: { type: "contract_call", contractId: "SP::c" } },
		schema: {
			data: {
				columns: {
					seller: { type: "principal" },
					status: { type: "text" },
				},
				indexes: [["seller", "status"]],
			},
		},
		handlers: { handler: () => {} },
	};
	const { statements } = generateSubgraphSQL(def);
	const compositeIdx = statements.find((s) => s.includes("composite_0"));
	expect(compositeIdx).toBeDefined();
	expect(compositeIdx).toContain("(seller, status)");
});
