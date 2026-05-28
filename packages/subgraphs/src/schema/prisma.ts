import type {
	ColumnType,
	SubgraphDefinition,
	SubgraphTable,
} from "../types.ts";
import { pgSchemaName } from "./utils.ts";

/**
 * Generate a `schema.prisma` from a subgraph definition. Pairs with the BYO data
 * plane: once a subgraph's decoded rows land in the user's own Postgres, this
 * emits the Prisma models so they get a fully-typed ORM (joins, relations,
 * transactions) over their own data — the "Prisma wrapper for Stacks" without us
 * shipping an ORM. Output mirrors the DDL in `generator.ts` so `prisma db pull`
 * against a deployed schema produces a matching model (no drift).
 */

/** Clarity/subgraph column type → Prisma field type + optional `@db` native type. */
const PRISMA_TYPE: Record<ColumnType, { type: string; db?: string }> = {
	// uint128/int128 exceed JS/Prisma BigInt-safe range — Decimal is lossless.
	uint: { type: "Decimal", db: "@db.Numeric" },
	int: { type: "Decimal", db: "@db.Numeric" },
	text: { type: "String" },
	principal: { type: "String" },
	boolean: { type: "Boolean" },
	timestamp: { type: "DateTime", db: "@db.Timestamptz" },
	jsonb: { type: "Json" },
};

/** System columns every subgraph table gets (kept in sync with generator.ts). */
const SYSTEM_FIELDS: Array<{ field: string; col: string; line: string }> = [
	{ field: "id", col: "_id", line: "BigInt   @id @default(autoincrement())" },
	{ field: "blockHeight", col: "_block_height", line: "BigInt" },
	{ field: "txId", col: "_tx_id", line: "String" },
	{
		field: "createdAt",
		col: "_created_at",
		line: "DateTime @default(now()) @db.Timestamptz",
	},
];

function snakeToCamel(name: string): string {
	return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function pascalCase(name: string): string {
	const camel = snakeToCamel(name);
	return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function quotePrismaDefault(value: string | number | boolean): string {
	if (typeof value === "string")
		return `@default("${value.replace(/"/g, '\\"')}")`;
	return `@default(${value})`;
}

/** A back-relation field another table's relation induces on this one. */
interface BackRelation {
	field: string;
	model: string;
	relationName: string;
}

function renderTable(
	tableName: string,
	table: SubgraphTable,
	backRelations: BackRelation[],
): string {
	const lines: string[] = [];

	for (const sys of SYSTEM_FIELDS) {
		lines.push(`  ${sys.field} ${sys.line} @map("${sys.col}")`);
	}

	for (const [colName, col] of Object.entries(table.columns)) {
		const field = snakeToCamel(colName);
		const mapped = PRISMA_TYPE[col.type];
		const optional = col.nullable ? "?" : "";
		const attrs: string[] = [];
		if (field !== colName) attrs.push(`@map("${colName}")`);
		if (col.default !== undefined) attrs.push(quotePrismaDefault(col.default));
		if (mapped.db) attrs.push(mapped.db);
		lines.push(
			`  ${field} ${mapped.type}${optional}${attrs.length ? ` ${attrs.join(" ")}` : ""}`,
		);
	}

	// Forward relations (this table owns the FK).
	for (const rel of table.relations ?? []) {
		const optional = rel.fields.some((f) => table.columns[f]?.nullable)
			? "?"
			: "";
		const relName = `${pascalCase(tableName)}_${rel.name}`;
		const fields = rel.fields.map(snakeToCamel).join(", ");
		const refs = rel.referencedColumns.map(snakeToCamel).join(", ");
		lines.push(
			`  ${rel.name} ${pascalCase(rel.references)}${optional} @relation("${relName}", fields: [${fields}], references: [${refs}])`,
		);
	}

	// Back relations (another table points here) — Prisma needs both sides.
	for (const back of backRelations) {
		lines.push(
			`  ${back.field} ${back.model}[] @relation("${back.relationName}")`,
		);
	}

	// Block attributes: per-column @@index, composite @@index, @@unique.
	const block: string[] = [];
	for (const [colName, col] of Object.entries(table.columns)) {
		if (col.indexed) block.push(`  @@index([${snakeToCamel(colName)}])`);
	}
	for (const cols of table.indexes ?? []) {
		block.push(`  @@index([${cols.map(snakeToCamel).join(", ")}])`);
	}
	for (const cols of table.uniqueKeys ?? []) {
		block.push(`  @@unique([${cols.map(snakeToCamel).join(", ")}])`);
	}
	block.push(`  @@map("${tableName}")`);

	return `model ${pascalCase(tableName)} {\n${lines.join("\n")}\n\n${block.join("\n")}\n}`;
}

/** Compute the back-relation field each table receives from others' relations. */
function computeBackRelations(
	schema: Record<string, SubgraphTable>,
): Map<string, BackRelation[]> {
	const map = new Map<string, BackRelation[]>();
	for (const [owningTable, table] of Object.entries(schema)) {
		for (const rel of table.relations ?? []) {
			const list = map.get(rel.references) ?? [];
			list.push({
				field: `${snakeToCamel(owningTable)}${pascalCase(rel.name)}`,
				model: pascalCase(owningTable),
				relationName: `${pascalCase(owningTable)}_${rel.name}`,
			});
			map.set(rel.references, list);
		}
	}
	return map;
}

export interface PrismaGenOptions {
	/** Postgres schema the tables live in (account-scoped). */
	schemaName?: string;
	/** env var the datasource url reads from. */
	datasourceEnv?: string;
	/**
	 * Emit only the `model` blocks (no datasource/generator). Lets users compose
	 * these models with their own schema via Prisma's `prismaSchemaFolder`.
	 */
	modelsOnly?: boolean;
}

export function generatePrismaSchema(
	def: SubgraphDefinition,
	opts: PrismaGenOptions = {},
): string {
	const schemaName = opts.schemaName ?? pgSchemaName(def.name);
	const env = opts.datasourceEnv ?? "DATABASE_URL";

	const header = [
		`// Generated by \`sl generate prisma\` from subgraph "${def.name}". Do not edit by hand.`,
		"",
		"datasource db {",
		'  provider = "postgresql"',
		`  url      = env("${env}")`,
		`  schemas  = ["${schemaName}"]`,
		"}",
		"",
		"generator client {",
		'  provider        = "prisma-client-js"',
		'  previewFeatures = ["multiSchema"]',
		"}",
	].join("\n");

	// Fold @@schema into each model block (it must live inside the block).
	const backRelations = computeBackRelations(def.schema);
	const modelBlocks = Object.entries(def.schema).map(([tableName, table]) => {
		const body = renderTable(
			tableName,
			table,
			backRelations.get(tableName) ?? [],
		);
		return body.replace(/\n}$/, `\n  @@schema("${schemaName}")\n}`);
	});

	if (opts.modelsOnly) return `${modelBlocks.join("\n\n")}\n`;
	return `${header}\n\n${modelBlocks.join("\n\n")}\n`;
}
