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

test("validateSubgraphDefinition rejects FK relation name that is not a SQL identifier", () => {
	const withRelName = (name: string) => ({
		name: "rel-test",
		sources: { handler: { type: "contract_call", contractId: "SP000::c" } },
		schema: {
			sales: {
				columns: { listing_id: { type: "uint" } },
				relations: [
					{
						name,
						fields: ["listing_id"],
						references: "listings",
						referencedColumns: ["id"],
					},
				],
			},
			listings: { columns: { id: { type: "uint" } } },
		},
		handlers: { handler: () => {} },
	});

	expect(() =>
		validateSubgraphDefinition(withRelName('x") ; DROP TABLE foo; --')),
	).toThrow();
	expect(() => validateSubgraphDefinition(withRelName("my-rel"))).toThrow();
	expect(() =>
		validateSubgraphDefinition(withRelName("listing")),
	).not.toThrow();
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

// ── ABI validation ───────────────────────────────────────────────────

const CANONICAL_ABI = {
	functions: [
		{
			name: "transfer",
			access: "public",
			args: [
				{ name: "amount", type: "uint128" },
				{ name: "memo", type: { optional: { buff: { length: 34 } } } },
			],
			outputs: { response: { ok: "bool", error: "uint128" } },
		},
	],
};

function withAbi(abi: unknown) {
	return {
		name: "abi-test",
		sources: {
			call: {
				type: "contract_call",
				contractId: "SP000.c",
				functionName: "transfer",
				abi,
			},
		},
		schema: { calls: { columns: { amount: { type: "uint" } } } },
		handlers: { call: () => {} },
	};
}

test("a canonical ABI passes deploy validation", () => {
	expect(() =>
		validateSubgraphDefinition(withAbi(CANONICAL_ABI)),
	).not.toThrow();
});

test("a raw Hiro/Clarinet ABI is refused at deploy, not mis-decoded at runtime", () => {
	// `read_only` access and outputs wrapped as `{ type: … }` — the shapes the
	// Hiro API and Clarinet SDK emit. These used to validate clean (the field
	// was `z.record(z.any())`) and then mis-decode `event.input` per event.
	const rawAccess = {
		functions: [
			{
				...CANONICAL_ABI.functions[0],
				access: "read_only",
			},
		],
	};
	expect(() => validateSubgraphDefinition(withAbi(rawAccess))).toThrow();

	const wrappedOutputs = {
		functions: [
			{
				...CANONICAL_ABI.functions[0],
				outputs: { type: { response: { ok: "bool", error: "uint128" } } },
			},
		],
	};
	expect(() => validateSubgraphDefinition(withAbi(wrappedOutputs))).toThrow();
});

test("a garbage ABI is refused", () => {
	expect(() => validateSubgraphDefinition(withAbi({ nope: true }))).toThrow();
	expect(() =>
		validateSubgraphDefinition(withAbi({ functions: [{ name: "x" }] })),
	).toThrow();
});

// ── Filter union: bad field/type combos fail at deploy ────────────────

function withSource(source: unknown) {
	return {
		name: "filter-test",
		sources: { s: source },
		schema: { t: { columns: { a: { type: "uint" } } } },
		handlers: { s: () => {} },
	};
}

test("a field the source type does not support is refused at deploy", () => {
	// This validated clean under the old flat schema and then matched
	// nothing, forever: contract_deploy has no assetIdentifier or minAmount.
	expect(() =>
		validateSubgraphDefinition(
			withSource({
				type: "contract_deploy",
				assetIdentifier: "SP1.t::t",
				minAmount: 1n,
			}),
		),
	).toThrow();
	// stx_mint has no sender (only recipient).
	expect(() =>
		validateSubgraphDefinition(withSource({ type: "stx_mint", sender: "SP1" })),
	).toThrow();
	// print_event has no assetIdentifier.
	expect(() =>
		validateSubgraphDefinition(
			withSource({ type: "print_event", assetIdentifier: "SP1.t::t" }),
		),
	).toThrow();
});

test("valid per-type field sets still pass", () => {
	expect(() =>
		validateSubgraphDefinition(
			withSource({ type: "stx_transfer", sender: "SP1", minAmount: 1n }),
		),
	).not.toThrow();
	expect(() =>
		validateSubgraphDefinition(
			withSource({ type: "ft_transfer", trait: "sip-010" }),
		),
	).not.toThrow();
});

test("contractId accepts a set of contracts (a router plus its pools)", () => {
	expect(() =>
		validateSubgraphDefinition(
			withSource({
				type: "contract_call",
				contractId: ["SP1.router", "SP1.pool-a", "SP1.pool-b"],
			}),
		),
	).not.toThrow();
	// Capped at the same 20 the Index API enforces.
	expect(() =>
		validateSubgraphDefinition(
			withSource({
				type: "contract_call",
				contractId: Array.from({ length: 21 }, (_, i) => `SP1.pool-${i}`),
			}),
		),
	).toThrow();
});

test("trait and contractId compose (trait-scoped, narrowed to ids)", () => {
	// The matcher ANDs them, so this means "sip-010 contracts, but only this
	// one". Refusing the pair would break already-deployed subgraphs.
	expect(() =>
		validateSubgraphDefinition(
			withSource({
				type: "contract_call",
				trait: "sip-010",
				contractId: "SP1.token",
			}),
		),
	).not.toThrow();
});
