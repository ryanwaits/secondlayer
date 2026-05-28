import type {
	ColumnType,
	SubgraphDefinition,
	SubgraphTable,
} from "../types.ts";
import { pgSchemaName } from "./utils.ts";

/**
 * Generate a Drizzle schema from a subgraph definition — the Drizzle arm of the
 * "Prisma wrapper for Stacks" story. Emits `pgSchema().table()` defs, `relations()`
 * (so the relational query API `db.query.x.findMany({ with: {…} })` works), and
 * `$inferSelect` row types. Like the Prisma generator, output mirrors the deployed
 * DDL — these tables are processor-written and owned by the BYO deploy, so treat
 * them read-only and never `drizzle-kit push`.
 */

/** Subgraph column type → Drizzle pg-core builder. */
const DRIZZLE_BUILDER: Record<ColumnType, (col: string) => string> = {
	// numeric() returns string in Drizzle — lossless for Clarity uint128/int128.
	uint: (c) => `numeric("${c}")`,
	int: (c) => `numeric("${c}")`,
	text: (c) => `text("${c}")`,
	principal: (c) => `text("${c}")`,
	boolean: (c) => `boolean("${c}")`,
	timestamp: (c) => `timestamp("${c}", { withTimezone: true })`,
	jsonb: (c) => `jsonb("${c}")`,
};

const BUILDERS_USED: Record<ColumnType, string> = {
	uint: "numeric",
	int: "numeric",
	text: "text",
	principal: "text",
	boolean: "boolean",
	timestamp: "timestamp",
	jsonb: "jsonb",
};

function snakeToCamel(name: string): string {
	return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function pascalCase(name: string): string {
	const camel = snakeToCamel(name);
	return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function literalDefault(value: string | number | boolean): string {
	return typeof value === "string"
		? `"${value.replace(/"/g, '\\"')}"`
		: `${value}`;
}

function renderTable(
	varName: string,
	tableName: string,
	table: SubgraphTable,
): string {
	const cols: string[] = [
		`  id: bigserial("_id", { mode: "bigint" }).primaryKey(),`,
		`  blockHeight: bigint("_block_height", { mode: "bigint" }).notNull(),`,
		`  txId: text("_tx_id").notNull(),`,
		`  createdAt: timestamp("_created_at", { withTimezone: true }).notNull().defaultNow(),`,
	];
	for (const [colName, col] of Object.entries(table.columns)) {
		let line = `  ${snakeToCamel(colName)}: ${DRIZZLE_BUILDER[col.type](colName)}`;
		if (!col.nullable) line += ".notNull()";
		if (col.default !== undefined)
			line += `.default(${literalDefault(col.default)})`;
		cols.push(`${line},`);
	}

	// Third-arg table extras: indexes + unique constraints.
	const extras: string[] = [];
	for (const [colName, col] of Object.entries(table.columns)) {
		if (col.indexed) {
			const f = snakeToCamel(colName);
			extras.push(
				`    ${f}Idx: index("idx_${tableName}_${colName}").on(t.${f})`,
			);
		}
	}
	table.indexes?.forEach((idxCols, i) => {
		const on = idxCols.map((c) => `t.${snakeToCamel(c)}`).join(", ");
		extras.push(`    idx${i}: index("idx_${tableName}_${i}").on(${on})`);
	});
	table.uniqueKeys?.forEach((uqCols, i) => {
		const on = uqCols.map((c) => `t.${snakeToCamel(c)}`).join(", ");
		extras.push(`    uq${i}: uniqueIndex("uq_${tableName}_${i}").on(${on})`);
	});

	const extrasBlock = extras.length
		? `, (t) => ({\n${extras.join(",\n")},\n  })`
		: "";
	return `export const ${varName} = sg.table("${tableName}", {\n${cols.join("\n")}\n}${extrasBlock});`;
}

function renderRelations(schema: Record<string, SubgraphTable>): string[] {
	// Back-relations: target table → list of owning tables referencing it.
	const back = new Map<string, Array<{ field: string; from: string }>>();
	for (const [owning, table] of Object.entries(schema)) {
		for (const rel of table.relations ?? []) {
			const list = back.get(rel.references) ?? [];
			list.push({
				field: `${snakeToCamel(owning)}${pascalCase(rel.name)}`,
				from: snakeToCamel(owning),
			});
			back.set(rel.references, list);
		}
	}

	const out: string[] = [];
	for (const [tableName, table] of Object.entries(schema)) {
		const v = snakeToCamel(tableName);
		const ones = (table.relations ?? []).map((rel) => {
			const localFields = rel.fields
				.map((f) => `${v}.${snakeToCamel(f)}`)
				.join(", ");
			const refFields = rel.referencedColumns
				.map((c) => `${snakeToCamel(rel.references)}.${snakeToCamel(c)}`)
				.join(", ");
			return `  ${rel.name}: one(${snakeToCamel(rel.references)}, { fields: [${localFields}], references: [${refFields}] }),`;
		});
		const manys = (back.get(tableName) ?? []).map(
			(b) => `  ${b.field}: many(${b.from}),`,
		);
		if (ones.length === 0 && manys.length === 0) continue;
		const helpers = [ones.length ? "one" : "", manys.length ? "many" : ""]
			.filter(Boolean)
			.join(", ");
		out.push(
			`export const ${v}Relations = relations(${v}, ({ ${helpers} }) => ({\n${[...ones, ...manys].join("\n")}\n}));`,
		);
	}
	return out;
}

export interface DrizzleGenOptions {
	schemaName?: string;
}

export function generateDrizzleSchema(
	def: SubgraphDefinition,
	opts: DrizzleGenOptions = {},
): string {
	const schemaName = opts.schemaName ?? pgSchemaName(def.name);

	// Only import the column builders actually used (+ always-used system ones).
	const used = new Set<string>(["bigserial", "bigint", "text", "timestamp"]);
	let needsIndex = false;
	let needsUnique = false;
	for (const table of Object.values(def.schema)) {
		for (const col of Object.values(table.columns))
			used.add(BUILDERS_USED[col.type]);
		if (
			Object.values(table.columns).some((c) => c.indexed) ||
			table.indexes?.length
		)
			needsIndex = true;
		if (table.uniqueKeys?.length) needsUnique = true;
	}
	if (needsIndex) used.add("index");
	if (needsUnique) used.add("uniqueIndex");
	used.add("pgSchema");

	const hasRelations = Object.values(def.schema).some(
		(t) => t.relations?.length,
	);
	const imports = [
		`import { ${[...used].sort().join(", ")} } from "drizzle-orm/pg-core";`,
		...(hasRelations ? [`import { relations } from "drizzle-orm";`] : []),
	].join("\n");

	const tables = Object.entries(def.schema).map(([name, table]) =>
		renderTable(snakeToCamel(name), name, table),
	);
	const relationDecls = renderRelations(def.schema);
	const typeExports = Object.keys(def.schema).map(
		(name) =>
			`export type ${pascalCase(name)} = typeof ${snakeToCamel(name)}.$inferSelect;`,
	);

	return [
		`// Generated by \`sl generate drizzle\` from subgraph "${def.name}". Do not edit by hand.`,
		imports,
		"",
		`export const sg = pgSchema("${schemaName}");`,
		"",
		tables.join("\n\n"),
		...(relationDecls.length ? ["", relationDecls.join("\n\n")] : []),
		"",
		typeExports.join("\n"),
		"",
	].join("\n");
}
