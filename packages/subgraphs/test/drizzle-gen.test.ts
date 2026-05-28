import { describe, expect, test } from "bun:test";
import { generateDrizzleSchema } from "../src/schema/drizzle.ts";
import type { SubgraphDefinition } from "../src/types.ts";

const def: SubgraphDefinition = {
	name: "dex",
	version: "1.0.0",
	sources: { t: { type: "contract_call", contractId: "SP.dex" } },
	schema: {
		pools: {
			columns: { pool_id: { type: "principal" }, fee: { type: "uint" } },
			uniqueKeys: [["pool_id"]],
		},
		swaps: {
			columns: {
				pool: { type: "principal" },
				amount: { type: "uint" },
				trader: { type: "principal", indexed: true },
				note: { type: "text", nullable: true },
			},
			relations: [
				{
					name: "poolRef",
					references: "pools",
					fields: ["pool"],
					referencedColumns: ["pool_id"],
				},
			],
		},
	},
	handlers: { t: async () => {} },
};

describe("generateDrizzleSchema", () => {
	const out = generateDrizzleSchema(def, { schemaName: "subgraph_dex" });

	test("imports only used builders + relations", () => {
		expect(out).toContain('from "drizzle-orm/pg-core"');
		expect(out).toContain("bigserial");
		expect(out).toContain("numeric");
		expect(out).toContain("index");
		expect(out).toContain("uniqueIndex");
		expect(out).toContain('import { relations } from "drizzle-orm";');
	});

	test("pgSchema + table with system + mapped columns", () => {
		expect(out).toContain('export const sg = pgSchema("subgraph_dex");');
		expect(out).toContain('export const swaps = sg.table("swaps", {');
		expect(out).toContain(
			'id: bigserial("_id", { mode: "bigint" }).primaryKey()',
		);
		expect(out).toContain('amount: numeric("amount").notNull()');
		expect(out).toContain('note: text("note"),'); // nullable → no .notNull()
	});

	test("indexes + unique constraints in third arg", () => {
		expect(out).toContain('traderIdx: index("idx_swaps_trader").on(t.trader)');
		expect(out).toContain('uq0: uniqueIndex("uq_pools_0").on(t.poolId)');
	});

	test("relations() with one() forward + many() back", () => {
		expect(out).toContain("export const swapsRelations = relations(swaps");
		expect(out).toContain(
			"poolRef: one(pools, { fields: [swaps.pool], references: [pools.poolId] })",
		);
		expect(out).toContain("export const poolsRelations = relations(pools");
		expect(out).toContain("swapsPoolRef: many(swaps)");
	});

	test("$inferSelect type exports", () => {
		expect(out).toContain("export type Pools = typeof pools.$inferSelect;");
		expect(out).toContain("export type Swaps = typeof swaps.$inferSelect;");
	});
});
