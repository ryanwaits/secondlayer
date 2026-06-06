import { createHash } from "node:crypto";
import type {
	ColumnType,
	SubgraphDefinition,
	SubgraphTable,
} from "../types.ts";
import { pgSchemaName } from "./utils.ts";

export const TYPE_MAP: Record<ColumnType, string> = {
	text: "TEXT",
	uint: "NUMERIC",
	int: "NUMERIC",
	principal: "TEXT",
	boolean: "BOOLEAN",
	timestamp: "TIMESTAMPTZ",
	jsonb: "JSONB",
};

export interface GeneratedSQL {
	statements: string[];
	hash: string;
}

function escapeLiteralDefault(value: unknown): string {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "number" || typeof value === "bigint")
		return String(value);
	if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
	return `'${String(value).replace(/'/g, "''")}'`;
}

/** True if any column on the table uses full-text `search` (needs the pg_trgm
 *  extension before its GIN index can be created). */
export function tableNeedsTrgm(tableDef: SubgraphTable): boolean {
	return Object.values(tableDef.columns).some((col) => col.search);
}

/**
 * All per-table DDL for ONE table — create + meta/user/composite indexes + UNIQUE
 * constraints (NOT foreign keys; see {@link emitForeignKeyDDL}, emitted in a
 * second pass once every referenced table exists). Single-sourced so the full
 * generator and the deployer's additive-create path can't drift — a missing
 * UNIQUE or DEFAULT here would make a handler `upsert ON CONFLICT` fail at runtime.
 */
export function emitTableDDL(
	schemaName: string,
	tableName: string,
	tableDef: SubgraphTable,
): string[] {
	const qualifiedName = `${schemaName}.${tableName}`;
	const statements: string[] = [];

	const columnDefs: string[] = [
		"_id BIGSERIAL PRIMARY KEY",
		"_block_height BIGINT NOT NULL",
		"_tx_id TEXT NOT NULL",
		"_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
	];
	for (const [colName, col] of Object.entries(tableDef.columns)) {
		const sqlType = TYPE_MAP[col.type];
		const nullable = col.nullable ? "" : " NOT NULL";
		let colDef = `${colName} ${sqlType}${nullable}`;
		if (col.default !== undefined) {
			colDef += ` DEFAULT ${escapeLiteralDefault(col.default)}`;
		}
		columnDefs.push(colDef);
	}
	statements.push(
		`CREATE TABLE IF NOT EXISTS ${qualifiedName} (\n  ${columnDefs.join(",\n  ")}\n)`,
	);

	// Auto-indexes on meta columns.
	statements.push(
		`CREATE INDEX IF NOT EXISTS idx_${schemaName}_${tableName}_block_height ON ${qualifiedName} (_block_height)`,
	);
	statements.push(
		`CREATE INDEX IF NOT EXISTS idx_${schemaName}_${tableName}_tx_id ON ${qualifiedName} (_tx_id)`,
	);

	// Single-column indexes.
	for (const [colName, col] of Object.entries(tableDef.columns)) {
		if (col.indexed) {
			statements.push(
				`CREATE INDEX IF NOT EXISTS idx_${schemaName}_${tableName}_${colName} ON ${qualifiedName} (${colName})`,
			);
		}
	}

	// Trigram GIN indexes for search columns.
	for (const [colName, col] of Object.entries(tableDef.columns)) {
		if (col.search) {
			statements.push(
				`CREATE INDEX IF NOT EXISTS idx_${schemaName}_${tableName}_${colName}_trgm ON ${qualifiedName} USING gin (${colName} gin_trgm_ops)`,
			);
		}
	}

	// Composite indexes.
	if (tableDef.indexes) {
		for (let i = 0; i < tableDef.indexes.length; i++) {
			// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
			const cols = tableDef.indexes[i]!;
			const idxName = `idx_${schemaName}_${tableName}_composite_${i}`;
			statements.push(
				`CREATE INDEX IF NOT EXISTS ${idxName} ON ${qualifiedName} (${cols.join(", ")})`,
			);
		}
	}

	// Unique constraints (required for upsert ON CONFLICT).
	if (tableDef.uniqueKeys) {
		for (let i = 0; i < tableDef.uniqueKeys.length; i++) {
			// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
			const cols = tableDef.uniqueKeys[i]!;
			const constraintName = `uq_${schemaName}_${tableName}_${cols.join("_")}`;
			statements.push(
				`ALTER TABLE ${qualifiedName} ADD CONSTRAINT ${constraintName} UNIQUE (${cols.join(", ")})`,
			);
		}
	}

	return statements;
}

/** Foreign-key DDL for one table's relations. Emit AFTER every referenced table
 *  exists; references require the target columns to be a UNIQUE key. */
export function emitForeignKeyDDL(
	schemaName: string,
	tableName: string,
	tableDef: SubgraphTable,
): string[] {
	return (tableDef.relations ?? []).map((rel) => {
		const constraintName = `fk_${schemaName}_${tableName}_${rel.name}`;
		return (
			`ALTER TABLE ${schemaName}.${tableName} ADD CONSTRAINT ${constraintName} ` +
			`FOREIGN KEY (${rel.fields.join(", ")}) ` +
			`REFERENCES ${schemaName}.${rel.references} (${rel.referencedColumns.join(", ")})`
		);
	});
}

/**
 * Generates PostgreSQL DDL statements for a subgraph definition.
 * Creates a dedicated schema `subgraph_<name>` with one table per schema entry,
 * each with auto-columns and indexes.
 */
export function generateSubgraphSQL(
	def: SubgraphDefinition,
	schemaNameOverride?: string,
): GeneratedSQL {
	const schemaName = schemaNameOverride ?? pgSchemaName(def.name);
	const statements: string[] = [];

	// Check if any column uses search (trigram)
	const needsTrgm = Object.values(def.schema).some((table) =>
		Object.values(table.columns).some((col) => col.search),
	);

	if (needsTrgm) {
		statements.push("CREATE EXTENSION IF NOT EXISTS pg_trgm");
	}

	// Schema namespace
	statements.push(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);

	// One table per schema entry (single-sourced per-table DDL).
	for (const [tableName, tableDef] of Object.entries(def.schema)) {
		statements.push(...emitTableDDL(schemaName, tableName, tableDef));
	}

	// Foreign keys are added in a second pass so every referenced table exists.
	// These mirror the ORM relations emitted by the codegen (no drift) and require
	// the referenced columns to be a UNIQUE key on the target table.
	for (const [tableName, tableDef] of Object.entries(def.schema)) {
		statements.push(...emitForeignKeyDDL(schemaName, tableName, tableDef));
	}

	// Hash based on schema structure only — version intentionally excluded
	// so server-managed version bumps don't look like schema changes
	const hashInput = JSON.stringify(
		{
			name: def.name,
			schema: def.schema,
			sources: def.sources,
		},
		(_key, value) => (typeof value === "bigint" ? value.toString() : value),
	);
	// node crypto (not Bun.hash) so the published node-runtime `sl` CLI can
	// compute schema hashes too (e.g. `sl subgraphs spec`).
	const hash = createHash("sha256").update(hashInput).digest("hex");

	return { statements, hash };
}
