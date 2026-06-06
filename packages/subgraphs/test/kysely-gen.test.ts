import { describe, expect, test } from "bun:test";
import { generateKyselySchema } from "../src/schema/kysely.ts";
import type { SubgraphDefinition } from "../src/types.ts";

const def: SubgraphDefinition = {
	name: "dex",
	version: "1.0.0",
	sources: { t: { type: "contract_call", contractId: "SP.dex" } },
	schema: {
		pools: {
			columns: {
				pool_id: { type: "principal" },
				fee: { type: "uint" },
				active: { type: "boolean", default: true },
			},
			uniqueKeys: [["pool_id"]],
		},
		swaps: {
			columns: {
				pool: { type: "principal" },
				amount: { type: "uint" },
				trader: { type: "principal", indexed: true },
				note: { type: "text", nullable: true },
				meta: { type: "jsonb", nullable: true },
				at: { type: "timestamp" },
			},
		},
	},
	handlers: { t: async () => {} },
};

describe("generateKyselySchema", () => {
	const out = generateKyselySchema(def, { schemaName: "subgraph_dex" });

	test("imports kysely type helpers", () => {
		expect(out).toContain(
			'import type { Generated, Selectable } from "kysely";',
		);
	});

	test("interface with system + mapped columns (real DB names, lossless types)", () => {
		expect(out).toContain("export interface Swaps {");
		expect(out).toContain("  _id: Generated<string>;");
		expect(out).toContain("  _block_height: string;");
		expect(out).toContain("  _created_at: Generated<Date>;");
		expect(out).toContain("  amount: string;"); // uint → string (lossless)
		expect(out).toContain("  at: Date;"); // timestamp → Date
		expect(out).toContain("  note: string | null;"); // nullable
		expect(out).toContain("  meta: unknown | null;"); // jsonb nullable
	});

	test("DB-side default → Generated<>", () => {
		expect(out).toContain("  active: Generated<boolean>;");
	});

	test("DB registry keyed by schema-qualified table name", () => {
		expect(out).toContain("export interface DB {");
		expect(out).toContain('  "subgraph_dex.pools": Pools;');
		expect(out).toContain('  "subgraph_dex.swaps": Swaps;');
	});

	test("Selectable row aliases", () => {
		expect(out).toContain("export type PoolsRow = Selectable<Pools>;");
		expect(out).toContain("export type SwapsRow = Selectable<Swaps>;");
	});
});
