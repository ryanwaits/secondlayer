import { expect, test } from "bun:test";
import {
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
		sources: [{ contract: "SP000::contract" }],
		schema: {
			data: { columns: { amount: { type: "uint" } } },
		},
		handlers: { "*": () => {} },
	};

	const result = validateSubgraphDefinition(def);
	expect(result.name).toBe("test-subgraph");
});

test("validateSubgraphDefinition rejects empty schema (no tables)", () => {
	expect(() =>
		validateSubgraphDefinition({
			name: "bad",
			sources: [{ contract: "SP000::c" }],
			schema: {},
			handlers: { "*": () => {} },
		}),
	).toThrow("Schema must have at least one table");
});

test("validateSubgraphDefinition rejects table with no columns", () => {
	expect(() =>
		validateSubgraphDefinition({
			name: "bad",
			sources: [{ contract: "SP000::c" }],
			schema: { data: { columns: {} } },
			handlers: { "*": () => {} },
		}),
	).toThrow("Table must have at least one column");
});

test("validateSubgraphDefinition rejects source with neither contract nor type", () => {
	expect(() =>
		validateSubgraphDefinition({
			name: "bad",
			sources: [{ event: "transfer" }],
			schema: { data: { columns: { x: { type: "text" } } } },
			handlers: { "*": () => {} },
		}),
	).toThrow();
});

test("validateSubgraphDefinition rejects empty sources array", () => {
	expect(() =>
		validateSubgraphDefinition({
			name: "bad",
			sources: [],
			schema: { data: { columns: { x: { type: "text" } } } },
			handlers: { "*": () => {} },
		}),
	).toThrow();
});

test("validateSubgraphDefinition rejects invalid column type", () => {
	expect(() =>
		validateSubgraphDefinition({
			name: "bad",
			sources: [{ contract: "SP::c" }],
			schema: { data: { columns: { x: { type: "invalid" } } } },
			handlers: { "*": () => {} },
		}),
	).toThrow();
});

test("validateSubgraphDefinition accepts multiple tables", () => {
	const result = validateSubgraphDefinition({
		name: "multi",
		sources: [{ contract: "SP::c" }],
		schema: {
			listings: { columns: { price: { type: "uint" } } },
			sales: { columns: { buyer: { type: "principal" } } },
		},
		handlers: { "*": () => {} },
	});
	expect(Object.keys(result.schema)).toEqual(["listings", "sales"]);
});

test("validateSubgraphDefinition accepts type-based source", () => {
	const result = validateSubgraphDefinition({
		name: "transfers",
		sources: [{ type: "stx_transfer" }],
		schema: {
			data: { columns: { amount: { type: "uint" } } },
		},
		handlers: { stx_transfer: () => {} },
	});
	expect(result.sources[0]!.type).toBe("stx_transfer");
});

test("validateSubgraphDefinition accepts multiple sources", () => {
	const result = validateSubgraphDefinition({
		name: "multi-src",
		sources: [
			{ contract: "SP::marketplace" },
			{ contract: "SP::token", event: "transfer" },
			{ type: "stx_transfer" },
		],
		schema: {
			data: { columns: { x: { type: "text" } } },
		},
		handlers: { "*": () => {} },
	});
	expect(result.sources.length).toBe(3);
});
