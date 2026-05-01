import { type Kysely, sql } from "kysely";
import type {
	ColumnInfo,
	ForeignKeyInfo,
	SchemaInfo,
	TableInfo,
} from "./types.ts";

const IGNORED_TABLES = new Set([
	"schema_migrations",
	"kysely_migration",
	"kysely_migration_lock",
	"_prisma_migrations",
	"ar_internal_metadata",
]);

function isIgnored(name: string): boolean {
	return IGNORED_TABLES.has(name) || name.startsWith("kysely_migration");
}

export async function introspectSchema(
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	db: Kysely<any>,
	pgSchema = "public",
): Promise<SchemaInfo> {
	// 1. Tables
	const { rows: tableRows } = await sql<{ table_name: string }>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = ${pgSchema} AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `.execute(db);

	// 2. Columns
	const { rows: colRows } = await sql<{
		table_name: string;
		column_name: string;
		data_type: string;
		is_nullable: string;
		column_default: string | null;
	}>`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = ${pgSchema}
    ORDER BY table_name, ordinal_position
  `.execute(db);

	// 3. Primary keys + unique constraints
	const { rows: constraintRows } = await sql<{
		table_name: string;
		column_name: string;
		constraint_type: string;
	}>`
    SELECT tc.table_name, kcu.column_name, tc.constraint_type
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = ${pgSchema}
      AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
    ORDER BY tc.table_name, kcu.ordinal_position
  `.execute(db);

	// 4. Foreign keys
	const { rows: fkRows } = await sql<{
		from_table: string;
		from_column: string;
		to_table: string;
		to_column: string;
	}>`
    SELECT
      kcu.table_name AS from_table,
      kcu.column_name AS from_column,
      ccu.table_name AS to_table,
      ccu.column_name AS to_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
      AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = ${pgSchema}
  `.execute(db);

	// Build pk map: table → pk column(s)
	const pkMap = new Map<string, string>();
	const uniqueMap = new Map<string, Set<string>>();
	for (const row of constraintRows) {
		if (row.constraint_type === "PRIMARY KEY") {
			pkMap.set(row.table_name, row.column_name);
		}
		if (row.constraint_type === "UNIQUE") {
			if (!uniqueMap.has(row.table_name))
				uniqueMap.set(row.table_name, new Set());
			uniqueMap.get(row.table_name)?.add(row.column_name);
		}
	}

	// Build columns map
	const colsMap = new Map<string, ColumnInfo[]>();
	for (const row of colRows) {
		if (!colsMap.has(row.table_name)) colsMap.set(row.table_name, []);
		colsMap.get(row.table_name)?.push({
			name: row.column_name,
			dataType: row.data_type,
			nullable: row.is_nullable === "YES",
			hasDefault: row.column_default !== null,
			isPrimaryKey: pkMap.get(row.table_name) === row.column_name,
		});
	}

	// Assemble tables
	const tables = new Map<string, TableInfo>();
	for (const { table_name } of tableRows) {
		if (isIgnored(table_name)) continue;
		tables.set(table_name, {
			name: table_name,
			columns: colsMap.get(table_name) ?? [],
			primaryKey: pkMap.get(table_name) ?? "id",
			uniqueColumns: uniqueMap.get(table_name) ?? new Set(),
		});
	}

	// Assemble FKs (only for non-ignored tables)
	const foreignKeys: ForeignKeyInfo[] = fkRows
		.filter((fk) => !isIgnored(fk.from_table) && !isIgnored(fk.to_table))
		.map((fk) => ({
			fromTable: fk.from_table,
			fromColumn: fk.from_column,
			toTable: fk.to_table,
			toColumn: fk.to_column,
		}));

	return { tables, foreignKeys };
}
