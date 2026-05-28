import { describe, expect, test } from "bun:test";
import { generatePrismaSchema } from "../src/schema/prisma.ts";
import type { SubgraphDefinition } from "../src/types.ts";

const def: SubgraphDefinition = {
	name: "my-token",
	version: "1.0.0",
	sources: { t: { type: "ft_transfer" } },
	schema: {
		transfers: {
			columns: {
				sender: { type: "principal" },
				amount: { type: "uint" },
				memo: { type: "text", nullable: true },
				ok: { type: "boolean", default: true },
				meta: { type: "jsonb", nullable: true },
				asset_id: { type: "principal", indexed: true },
			},
			uniqueKeys: [["sender", "asset_id"]],
			indexes: [["sender", "amount"]],
		},
	},
	handlers: { t: async () => {} },
};

describe("generatePrismaSchema", () => {
	const out = generatePrismaSchema(def, {
		schemaName: "subgraph_acct_my_token",
	});

	test("emits datasource + multiSchema generator", () => {
		expect(out).toContain('provider = "postgresql"');
		expect(out).toContain('schemas  = ["subgraph_acct_my_token"]');
		expect(out).toContain('previewFeatures = ["multiSchema"]');
	});

	test("model maps to table + schema, system columns mapped", () => {
		expect(out).toContain("model Transfers {");
		expect(out).toContain('@@map("transfers")');
		expect(out).toContain('@@schema("subgraph_acct_my_token")');
		expect(out).toContain(
			'id BigInt   @id @default(autoincrement()) @map("_id")',
		);
		expect(out).toContain('blockHeight BigInt @map("_block_height")');
		expect(out).toContain('txId String @map("_tx_id")');
		expect(out).toContain(
			'createdAt DateTime @default(now()) @db.Timestamptz @map("_created_at")',
		);
	});

	test("column types map correctly (uint→Decimal, jsonb→Json, etc.)", () => {
		expect(out).toContain("sender String");
		expect(out).toContain("amount Decimal @db.Numeric");
		expect(out).toContain("memo String?"); // nullable, no @map (no rename needed)
		expect(out).toContain("ok Boolean @default(true)");
		expect(out).toContain("meta Json?");
	});

	test("snake_case column → camelCase field with @map", () => {
		expect(out).toContain('assetId String @map("asset_id")');
	});

	test("indexes + unique keys emitted with camelCased fields", () => {
		expect(out).toContain("@@index([assetId])");
		expect(out).toContain("@@index([sender, amount])");
		expect(out).toContain("@@unique([sender, assetId])");
	});
});

describe("generatePrismaSchema relations (A2b)", () => {
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
	const out = generatePrismaSchema(def, { schemaName: "subgraph_dex" });

	test("forward relation emitted on owning model", () => {
		expect(out).toContain(
			'poolRef Pools @relation("Swaps_poolRef", fields: [pool], references: [poolId])',
		);
	});

	test("back-relation emitted on referenced model", () => {
		expect(out).toContain('swapsPoolRef Swaps[] @relation("Swaps_poolRef")');
	});
});
