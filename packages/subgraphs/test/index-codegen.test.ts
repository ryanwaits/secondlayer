import { describe, expect, test } from "bun:test";
import {
	generateIndexSchema,
	INDEX_CODEGEN_TABLES,
} from "../src/schema/index-codegen.ts";

describe("generateIndexSchema", () => {
	test("kysely: typed interfaces + IndexDB registry + Selectable rows", () => {
		const out = generateIndexSchema("kysely", { tables: ["blocks"] });
		expect(out).toContain('import type { Selectable } from "kysely";');
		expect(out).toContain("export interface Blocks {");
		expect(out).toContain("  height: number;");
		expect(out).toContain("  hash: string;");
		expect(out).toContain("  burn_block_hash: string | null;"); // nullable
		expect(out).toContain("  canonical: boolean;");
		expect(out).toContain('  "blocks": Blocks;');
		expect(out).toContain("export type BlocksRow = Selectable<Blocks>;");
	});

	test("kysely: schemaName qualifies the DB registry key", () => {
		const out = generateIndexSchema("kysely", {
			tables: ["blocks"],
			schemaName: "stacks",
		});
		expect(out).toContain('  "stacks.blocks": Blocks;');
	});

	test("drizzle: pgTable defs + lossless types + $inferSelect", () => {
		const out = generateIndexSchema("drizzle", { tables: ["decoded_events"] });
		expect(out).toContain('from "drizzle-orm/pg-core"');
		expect(out).toContain('export const decodedEvents = pgTable("decoded_events"');
		expect(out).toContain('amount: text("amount"),'); // nullable → no .notNull()
		expect(out).toContain('blockHeight: integer("block_height").notNull()');
		expect(out).toContain('payload: jsonb("payload"),');
		expect(out).toContain(
			"export type DecodedEvents = typeof decodedEvents.$inferSelect;",
		);
	});

	test("json-schema: per-table $defs, nullable union, required", () => {
		const out = generateIndexSchema("json-schema", { tables: ["blocks"] });
		const doc = JSON.parse(out);
		expect(doc.$defs.Blocks.properties.height).toEqual({ type: "integer" });
		expect(doc.$defs.Blocks.properties.burn_block_hash).toEqual({
			type: ["string", "null"],
		});
		expect(doc.$defs.Blocks.required).toContain("height");
		expect(doc.$defs.Blocks.required).not.toContain("burn_block_hash");
	});

	test("covers every read table by default", () => {
		const out = generateIndexSchema("kysely");
		const pascal = (n: string) =>
			n
				.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
				.replace(/^[a-z]/, (c) => c.toUpperCase());
		for (const table of INDEX_CODEGEN_TABLES) {
			expect(out).toContain(`export interface ${pascal(table)} {`);
		}
	});

	test("unknown table throws with a helpful list", () => {
		expect(() => generateIndexSchema("kysely", { tables: ["nope"] })).toThrow(
			/Unknown Index table/,
		);
	});
});
