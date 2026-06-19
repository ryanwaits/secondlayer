import { expect, test } from "bun:test";
import {
	SqlIdentifierSchema,
	SubgraphNameSchema,
	validateSubgraphDefinition,
} from "../src/validate.ts";

test("SubgraphNameSchema rejects invalid names", () => {
	expect(() => SubgraphNameSchema.parse("")).toThrow();
	expect(() => SubgraphNameSchema.parse("UPPER")).toThrow();
	expect(() => SubgraphNameSchema.parse("123start")).toThrow();
	expect(() => SubgraphNameSchema.parse("has spaces")).toThrow();
	expect(() => SubgraphNameSchema.parse("has_underscore")).toThrow();
});

test("SubgraphNameSchema accepts valid names", () => {
	expect(SubgraphNameSchema.parse("my-subgraph")).toBe("my-subgraph");
	expect(SubgraphNameSchema.parse("subgraph123")).toBe("subgraph123");
	expect(SubgraphNameSchema.parse("a")).toBe("a");
});

test("validateSubgraphDefinition accepts valid definition", () => {
	const def = {
		name: "test-subgraph",
		sources: {
			handler: { type: "contract_call", contractId: "SP000::contract" },
		},
		schema: {
			data: { columns: { amount: { type: "uint" } } },
		},
		handlers: { handler: () => {} },
	};

	const result = validateSubgraphDefinition(def);
	expect(result.name).toBe("test-subgraph");
});

test("validateSubgraphDefinition rejects empty schema (no tables)", () => {
	expect(() =>
		validateSubgraphDefinition({
			name: "bad",
			sources: { handler: { type: "contract_call", contractId: "SP000::c" } },
			schema: {},
			handlers: { handler: () => {} },
		}),
	).toThrow("Schema must have at least one table");
});

test("validateSubgraphDefinition rejects table with no columns", () => {
	expect(() =>
		validateSubgraphDefinition({
			name: "bad",
			sources: { handler: { type: "contract_call", contractId: "SP000::c" } },
			schema: { data: { columns: {} } },
			handlers: { handler: () => {} },
		}),
	).toThrow("Table must have at least one column");
});

test("validateSubgraphDefinition rejects source with neither contract nor type", () => {
	expect(() =>
		validateSubgraphDefinition({
			name: "bad",
			// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
			sources: { bad: { event: "transfer" } as any },
			schema: { data: { columns: { x: { type: "text" } } } },
			handlers: { bad: () => {} },
		}),
	).toThrow();
});

test("validateSubgraphDefinition rejects empty sources array", () => {
	expect(() =>
		validateSubgraphDefinition({
			name: "bad",
			sources: {},
			schema: { data: { columns: { x: { type: "text" } } } },
			handlers: {},
		}),
	).toThrow();
});

test("validateSubgraphDefinition rejects invalid column type", () => {
	expect(() =>
		validateSubgraphDefinition({
			name: "bad",
			sources: { handler: { type: "contract_call", contractId: "SP::c" } },
			schema: { data: { columns: { x: { type: "invalid" } } } },
			handlers: { handler: () => {} },
		}),
	).toThrow();
});

test("validateSubgraphDefinition accepts multiple tables", () => {
	const result = validateSubgraphDefinition({
		name: "multi",
		sources: { handler: { type: "contract_call", contractId: "SP::c" } },
		schema: {
			listings: { columns: { price: { type: "uint" } } },
			sales: { columns: { buyer: { type: "principal" } } },
		},
		handlers: { handler: () => {} },
	});
	expect(Object.keys(result.schema)).toEqual(["listings", "sales"]);
});

test("validateSubgraphDefinition accepts type-based source", () => {
	const result = validateSubgraphDefinition({
		name: "transfers",
		sources: { stx: { type: "stx_transfer" } },
		schema: {
			data: { columns: { amount: { type: "uint" } } },
		},
		handlers: { stx: () => {} },
	});
	expect(result.sources.stx?.type).toBe("stx_transfer");
});

test("validateSubgraphDefinition accepts multiple sources", () => {
	const result = validateSubgraphDefinition({
		name: "multi-src",
		sources: {
			marketplace: { type: "contract_call", contractId: "SP::marketplace" },
			transfer: { type: "ft_transfer", assetIdentifier: "SP::token" },
			stx: { type: "stx_transfer" },
		},
		schema: {
			data: { columns: { x: { type: "text" } } },
		},
		handlers: { marketplace: () => {}, transfer: () => {}, stx: () => {} },
	});
	expect(Object.keys(result.sources).length).toBe(3);
});

// SQL identifier safety tests
test("SqlIdentifierSchema rejects unsafe identifiers", () => {
	expect(() => SqlIdentifierSchema.parse('evt"; DROP TABLE x; --')).toThrow();
	expect(() => SqlIdentifierSchema.parse("has-hyphen")).toThrow();
	expect(() => SqlIdentifierSchema.parse("123start")).toThrow();
	expect(() => SqlIdentifierSchema.parse("has space")).toThrow();
	expect(() => SqlIdentifierSchema.parse("")).toThrow();
});

test("SqlIdentifierSchema accepts valid identifiers", () => {
	expect(SqlIdentifierSchema.parse("transfers")).toBe("transfers");
	expect(SqlIdentifierSchema.parse("_private")).toBe("_private");
	expect(SqlIdentifierSchema.parse("col1")).toBe("col1");
	expect(SqlIdentifierSchema.parse("CamelCase")).toBe("CamelCase");
});

test("validateSubgraphDefinition rejects injection table name", () => {
	expect(() =>
		validateSubgraphDefinition({
			name: "bad",
			sources: { handler: { type: "contract_call", contractId: "SP000::c" } },
			schema: {
				'evt"; DROP TABLE x; --': { columns: { id: { type: "uint" } } },
			},
			handlers: { handler: () => {} },
		}),
	).toThrow();
});

test("validateSubgraphDefinition rejects injection column name", () => {
	expect(() =>
		validateSubgraphDefinition({
			name: "bad",
			sources: { handler: { type: "contract_call", contractId: "SP000::c" } },
			schema: { data: { columns: { 'amount"; --': { type: "uint" } } } },
			handlers: { handler: () => {} },
		}),
	).toThrow();
});

test("validateSubgraphDefinition rejects injection in uniqueKeys", () => {
	expect(() =>
		validateSubgraphDefinition({
			name: "bad",
			sources: { handler: { type: "contract_call", contractId: "SP000::c" } },
			schema: {
				data: {
					columns: { id: { type: "uint" } },
					uniqueKeys: [['id"; --']],
				},
			},
			handlers: { handler: () => {} },
		}),
	).toThrow();
});

test("validateSubgraphDefinition rejects injection in indexes", () => {
	expect(() =>
		validateSubgraphDefinition({
			name: "bad",
			sources: { handler: { type: "contract_call", contractId: "SP000::c" } },
			schema: {
				data: {
					columns: { col: { type: "text" } },
					indexes: [["col); DROP --"]],
				},
			},
			handlers: { handler: () => {} },
		}),
	).toThrow();
});

test("validateSubgraphDefinition accepts normal definition with uniqueKeys", () => {
	const result = validateSubgraphDefinition({
		name: "test-transfers",
		sources: { handler: { type: "contract_call", contractId: "SP000::c" } },
		schema: {
			transfers: {
				columns: {
					amount: { type: "uint" },
					sender: { type: "principal" },
				},
				uniqueKeys: [["sender"]],
			},
		},
		handlers: { handler: () => {} },
	});
	expect(result.name).toBe("test-transfers");
});
