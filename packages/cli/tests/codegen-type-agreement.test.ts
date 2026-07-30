import { describe, expect, test } from "bun:test";
import {
	generateDrizzleSchema,
	generateKyselySchema,
	generatePrismaSchema,
} from "@secondlayer/subgraphs";
import type { SubgraphDefinition } from "@secondlayer/subgraphs";
import { generateSubgraphConsumer } from "../src/generators/subgraphs.ts";

/**
 * The five generators used to disagree about the most basic Clarity mapping:
 * `uint` became `bigint` in the runtime client, `string` in Kysely,
 * `Decimal @db.Numeric` in Prisma, and `number` in the generated row
 * interfaces — which both failed to compile against the client it shipped
 * beside AND silently truncated `uint128` above 2^53.
 *
 * The row types are now aliases over the emitted `_schema`, so a generator
 * cannot answer a question the schema already answers. This test pins that.
 */

const DEF: SubgraphDefinition = {
	name: "type-agreement",
	sources: {},
	schema: {
		sales: {
			columns: {
				amount: { type: "uint" },
				seller: { type: "principal" },
				fee: { type: "uint", nullable: true },
			},
		},
	},
	handlers: {},
};

const DETAIL = {
	name: "type-agreement",
	tables: {
		sales: {
			endpoint: "/v1/subgraphs/type-agreement/sales",
			rowCount: 0,
			example: "",
			columns: {
				amount: { type: "uint", nullable: false },
				seller: { type: "principal", nullable: false },
				fee: { type: "uint", nullable: true },
			},
		},
	},
	// Unused by the consumer generator, present for the type.
	version: "1.0.0",
	status: "active",
	lastProcessedBlock: 0,
	health: {
		totalProcessed: 0,
		totalErrors: 0,
		errorRate: 0,
		lastError: null,
		lastErrorAt: null,
	},
	sync: {},
} as unknown as Parameters<typeof generateSubgraphConsumer>[1];

describe("codegen type agreement", () => {
	test("row types are derived from the schema, never a second hand-written map", async () => {
		const client = await generateSubgraphConsumer("type-agreement", DETAIL);
		// The alias form is the guarantee: whatever `InferTableRow` says for
		// `uint` is what the row type says, forever.
		expect(client).toContain("InferTableRow");
		expect(client).toContain("export type SalesRow = InferTableRow<");
		// The old hand-mapped interface (and its wrong `number`) is gone.
		expect(client).not.toContain("export interface SalesRow");
		expect(client).not.toMatch(/amount\??: number/);
	});

	test("every ORM target emits a lossless uint — never a JS number", () => {
		const kysely = generateKyselySchema(DEF);
		const prisma = generatePrismaSchema(DEF);
		const drizzle = generateDrizzleSchema(DEF);

		// uint128 exceeds Number.MAX_SAFE_INTEGER; a `number` column is data
		// loss, not a style preference.
		for (const [target, out] of [
			["kysely", kysely],
			["prisma", prisma],
			["drizzle", drizzle],
		] as const) {
			expect(out, `${target} must not map uint to number`).not.toMatch(
				/amount\??\s*:\s*number/,
			);
		}
		// And each target still emits the column.
		expect(kysely).toContain("amount");
		expect(prisma).toContain("amount");
		expect(drizzle).toContain("amount");
	});
});
