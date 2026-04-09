import type { ColumnType, SubgraphDefinition } from "../types.ts";
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
		statements.push(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
	}

	// Schema namespace
	statements.push(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);

	// One table per schema entry
	for (const [tableName, tableDef] of Object.entries(def.schema)) {
		const qualifiedName = `${schemaName}.${tableName}`;

		// Auto-columns + user columns
		const columnDefs: string[] = [
			`_id BIGSERIAL PRIMARY KEY`,
			`_block_height BIGINT NOT NULL`,
			`_tx_id TEXT NOT NULL`,
			`_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
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

		// Auto-indexes on meta columns
		statements.push(
			`CREATE INDEX IF NOT EXISTS idx_${schemaName}_${tableName}_block_height ON ${qualifiedName} (_block_height)`,
		);
		statements.push(
			`CREATE INDEX IF NOT EXISTS idx_${schemaName}_${tableName}_tx_id ON ${qualifiedName} (_tx_id)`,
		);

		// Single-column indexes
		for (const [colName, col] of Object.entries(tableDef.columns)) {
			if (col.indexed) {
				statements.push(
					`CREATE INDEX IF NOT EXISTS idx_${schemaName}_${tableName}_${colName} ON ${qualifiedName} (${colName})`,
				);
			}
		}

		// Trigram GIN indexes for search columns
		for (const [colName, col] of Object.entries(tableDef.columns)) {
			if (col.search) {
				statements.push(
					`CREATE INDEX IF NOT EXISTS idx_${schemaName}_${tableName}_${colName}_trgm ON ${qualifiedName} USING gin (${colName} gin_trgm_ops)`,
				);
			}
		}

		// Composite indexes
		if (tableDef.indexes) {
			for (let i = 0; i < tableDef.indexes.length; i++) {
				const cols = tableDef.indexes[i]!;
				const idxName = `idx_${schemaName}_${tableName}_composite_${i}`;
				statements.push(
					`CREATE INDEX IF NOT EXISTS ${idxName} ON ${qualifiedName} (${cols.join(", ")})`,
				);
			}
		}

		// Unique constraints (required for upsert ON CONFLICT)
		if (tableDef.uniqueKeys) {
			for (let i = 0; i < tableDef.uniqueKeys.length; i++) {
				const cols = tableDef.uniqueKeys[i]!;
				const constraintName = `uq_${schemaName}_${tableName}_${cols.join("_")}`;
				statements.push(
					`ALTER TABLE ${qualifiedName} ADD CONSTRAINT ${constraintName} UNIQUE (${cols.join(", ")})`,
				);
			}
		}
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
	const hash = String(Bun.hash(hashInput));

	return { statements, hash };
}
