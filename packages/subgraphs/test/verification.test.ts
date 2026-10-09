import { describe, expect, test } from "bun:test";
import pkg from "../package.json" with { type: "json" };
import type { SubgraphFilter } from "../src/types.ts";
import {
	type HandlerFinding,
	SUBGRAPHS_RUNTIME,
	computePin,
	deriveVerification,
	isDeterminismViolation,
} from "../src/verification.ts";

const C = "SP1HTBVD3JG9C05J7HBJTHGR0GGW7KXW28M5JS8QE.vault";
const date: HandlerFinding = {
	kind: "nondeterministic",
	name: "Date",
	reason: "wall-clock time differs per run",
	file: "subgraph.ts",
	line: 12,
	column: 5,
};
const client: HandlerFinding = {
	kind: "needs-l3",
	name: "ctx.client",
	reason: "contract reads need L3 proofs",
	file: "subgraph.ts",
	line: 20,
	column: 9,
};

describe("deriveVerification", () => {
	const cases: Array<{
		name: string;
		sources: Record<string, SubgraphFilter>;
		backfillMode?: "blocking" | "concurrent";
		findings?: HandlerFinding[];
		level: "L2" | "L3" | "none";
		verifiable: boolean;
		violation: boolean;
		reasons: string[];
	}> = [
		{
			name: "named state writes only",
			sources: {
				v: { type: "var_set", contractId: C, varName: "total" },
				m: { type: "map_set", contractId: C, map: "reserve" },
				d: { type: "map_delete", contractId: C },
			},
			level: "L2",
			verifiable: true,
			violation: false,
			reasons: [],
		},
		{
			name: "factory-scoped write source from a write source",
			sources: {
				reg: { type: "map_insert", contractId: C, map: "pools" },
				pools: { type: "var_set", factory: { from: "reg", field: "key" } },
			},
			level: "L2",
			verifiable: true,
			violation: false,
			reasons: [],
		},
		{
			name: "prints need re-execution",
			sources: {
				swaps: {
					type: "print_event",
					contractId: C,
					prints: { swap: { amount: "uint" } },
				},
			},
			level: "L3",
			verifiable: false,
			violation: false,
			reasons: ['print_event source "swaps" needs L3'],
		},
		{
			name: "contract calls need receipts",
			sources: {
				m: { type: "map_set", contractId: C },
				calls: { type: "contract_call", contractId: C },
			},
			level: "L3",
			verifiable: false,
			violation: false,
			reasons: ['contract_call source "calls" needs L3'],
		},
		{
			name: "asset events",
			sources: { t: { type: "ft_transfer", assetIdentifier: `${C}::t` } },
			level: "L3",
			verifiable: false,
			violation: false,
			reasons: ['ft_transfer source "t" needs L3'],
		},
		{
			name: "trait scope is never provable as written",
			sources: { m: { type: "map_set", trait: "sip-010" } },
			level: "none",
			verifiable: false,
			violation: false,
			reasons: ['source "m": trait scope needs a proven contract registry'],
		},
		{
			name: "tip-first backfill is not chain order",
			sources: { m: { type: "map_set", contractId: C } },
			backfillMode: "concurrent",
			level: "none",
			verifiable: false,
			violation: false,
			reasons: ["backfillMode concurrent: tip-first order is not chain order"],
		},
		{
			name: "ctx.client raises an L2 subgraph to L3",
			sources: { m: { type: "map_set", contractId: C } },
			findings: [client],
			level: "L3",
			verifiable: false,
			violation: false,
			reasons: [
				"subgraph.ts:20:9 ctx.client: contract reads need L3 proofs (needs L3)",
			],
		},
		{
			name: "forbidden global in an L2 subgraph is a violation",
			sources: { m: { type: "map_set", contractId: C } },
			findings: [date],
			level: "L2",
			verifiable: false,
			violation: true,
			reasons: ["subgraph.ts:12:5 Date: wall-clock time differs per run"],
		},
		{
			name: "forbidden global in an L3 subgraph is advice",
			sources: { t: { type: "stx_transfer" } },
			findings: [date],
			level: "L3",
			verifiable: false,
			violation: false,
			reasons: [
				'stx_transfer source "t" needs L3',
				"subgraph.ts:12:5 Date: wall-clock time differs per run",
			],
		},
	];

	for (const c of cases) {
		test(c.name, () => {
			const v = deriveVerification(
				{ sources: c.sources, backfillMode: c.backfillMode },
				c.findings,
			);
			expect(v.level).toBe(c.level);
			expect(v.verifiable).toBe(c.verifiable);
			expect(v.reasons).toEqual(c.reasons);
			expect(isDeterminismViolation(v)).toBe(c.violation);
			if (c.verifiable) {
				expect(v.unproven[0]).toContain("tx attribution");
			} else {
				expect(v.unproven).toEqual([]);
			}
		});
	}

	test("lists ten handler findings and counts the rest", () => {
		const many = Array.from({ length: 13 }, (_, i) => ({
			...date,
			line: i + 1,
		}));
		const v = deriveVerification(
			{ sources: { m: { type: "map_set", contractId: C } } },
			many,
		);
		expect(v.reasons).toHaveLength(11);
		expect(v.reasons.at(-1)).toBe("…and 3 more handler findings");
	});

	test("a needs-L3 finding past the listing cap still raises the level", () => {
		const v = deriveVerification(
			{ sources: { m: { type: "map_set", contractId: C } } },
			[...Array.from({ length: 10 }, () => date), client],
		);
		expect(v.level).toBe("L3");
	});
});

describe("computePin", () => {
	const base = {
		schemaHash: "a".repeat(64),
		handlerCode: "export default {};\n",
		startBlock: 1_230_000,
		network: "mainnet",
	};

	test("stable for identical inputs", () => {
		expect(computePin(base)).toBe(computePin({ ...base }));
		expect(computePin(base)).toMatch(/^[0-9a-f]{64}$/);
	});

	test("binds the runtime version of this package", () => {
		expect(SUBGRAPHS_RUNTIME).toBe(`@secondlayer/subgraphs@${pkg.version}`);
		expect(computePin(base)).toBe(
			computePin({ ...base, runtime: SUBGRAPHS_RUNTIME }),
		);
	});

	for (const [field, changed] of [
		["handler", { handlerCode: "export default { x: 1 };\n" }],
		["startBlock", { startBlock: 1_230_001 }],
		["unset startBlock", { startBlock: undefined }],
		["runtime", { runtime: "@secondlayer/subgraphs@99.0.0" }],
		["network", { network: "testnet" }],
		["schema hash", { schemaHash: "b".repeat(64) }],
	] as const) {
		test(`changes when the ${field} changes`, () => {
			expect(computePin({ ...base, ...changed })).not.toBe(computePin(base));
		});
	}
});
