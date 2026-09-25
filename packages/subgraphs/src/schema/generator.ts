import { createHash } from "node:crypto";
import type {
	ColumnType,
	SubgraphDefinition,
	SubgraphTable,
} from "../types.ts";
import { pgSchemaName, quotePgIdent } from "./utils.ts";

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

// Postgres truncates identifiers over 63 bytes. schema/table/column names are
// each individually capped at 63 (SqlIdentifierSchema / SubgraphNameSchema),
// but concatenated (`idx_<schema>_<table>_<col>_id`, plus an optional
// account-scoped schema prefix) they can exceed that — two different columns
// could then truncate to the same name and silently collide on CREATE INDEX.
// Route the sort-composite name through here: short names pass through
// unchanged (human-readable, matches the single-column naming style); an
// oversized name is truncated and given a content hash suffix so it can't
// collide with a different oversized name that happens to share a prefix.
const MAX_IDENT_BYTES = 63;
function safeIndexName(name: string): string {
	if (name.length <= MAX_IDENT_BYTES) return name;
	const hash = createHash("sha256").update(name).digest("hex").slice(0, 8);
	return `${name.slice(0, MAX_IDENT_BYTES - hash.length - 1)}_${hash}`;
}

/**
 * Plain equality index + `/v1` keyset composite `(col, _id)` for one
 * `indexed` column. Single source for {@link emitTableDDL} and additive
 * deploy — a missing composite on the add/flag-flip path made deep
 * `?_sort=` pages Filter/re-sort instead of an index-only scan.
 */
export function emitIndexedColumnIndexDDL(
	schemaName: string,
	tableName: string,
	colName: string,
	opts?: { concurrently?: boolean },
): { create: string[]; drop: string[] } {
	const concurrently = opts?.concurrently ? " CONCURRENTLY" : "";
	const qualified = `${quotePgIdent(schemaName)}.${quotePgIdent(tableName)}`;
	const plain = `idx_${schemaName}_${tableName}_${colName}`;
	const composite = safeIndexName(
		`idx_${schemaName}_${tableName}_${colName}_id`,
	);
	const col = quotePgIdent(colName);
	const id = quotePgIdent("_id");
	return {
		create: [
			`CREATE INDEX${concurrently} IF NOT EXISTS ${quotePgIdent(plain)} ON ${qualified} (${col})`,
			`CREATE INDEX${concurrently} IF NOT EXISTS ${quotePgIdent(composite)} ON ${qualified} (${col}, ${id})`,
		],
		drop: [
			`DROP INDEX${concurrently} IF EXISTS ${quotePgIdent(schemaName)}.${quotePgIdent(plain)}`,
			`DROP INDEX${concurrently} IF EXISTS ${quotePgIdent(schemaName)}.${quotePgIdent(composite)}`,
		],
	};
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
 * constraints. Single-sourced so the full
 * generator and the deployer's additive-create path can't drift — a missing
 * UNIQUE or DEFAULT here would make a handler `upsert ON CONFLICT` fail at runtime.
 */
export function emitTableDDL(
	schemaName: string,
	tableName: string,
	tableDef: SubgraphTable,
): string[] {
	const qualifiedName = `${quotePgIdent(schemaName)}.${quotePgIdent(tableName)}`;
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
		let colDef = `${quotePgIdent(colName)} ${sqlType}${nullable}`;
		if (col.default !== undefined) {
			colDef += ` DEFAULT ${escapeLiteralDefault(col.default)}`;
		}
		// uint is unsigned by definition — fail loudly instead of silently
		// storing a negative (fix-f040 B4). Handlers run in chain order, so a
		// legitimate same-block receive-then-spend never trips this.
		if (col.type === "uint") {
			colDef += ` CHECK (${quotePgIdent(colName)} >= 0)`;
		}
		columnDefs.push(colDef);
	}
	statements.push(
		`CREATE TABLE IF NOT EXISTS ${qualifiedName} (\n  ${columnDefs.join(",\n  ")}\n)`,
	);

	// Auto-indexes on meta columns.
	statements.push(
		`CREATE INDEX IF NOT EXISTS ${quotePgIdent(`idx_${schemaName}_${tableName}_block_height`)} ON ${qualifiedName} (_block_height)`,
	);
	statements.push(
		`CREATE INDEX IF NOT EXISTS ${quotePgIdent(`idx_${schemaName}_${tableName}_tx_id`)} ON ${qualifiedName} (_tx_id)`,
	);

	// Single-column indexes, plus a composite `(col, "_id")` sort index.
	// `/v1`'s `?_sort=<col>&_order=` keyset predicate compares `(col, "_id")`
	// and orders by `col, "_id"` — a composite index matches that exactly, so
	// deep pages on a low-cardinality column become an index-only scan instead
	// of a Filter/re-sort within each value group. The single-column index
	// stays too: it still serves plain equality filters (`?col=value`).
	for (const [colName, col] of Object.entries(tableDef.columns)) {
		if (col.indexed) {
			statements.push(
				...emitIndexedColumnIndexDDL(schemaName, tableName, colName).create,
			);
		}
	}

	// Trigram GIN indexes for search columns.
	for (const [colName, col] of Object.entries(tableDef.columns)) {
		if (col.search) {
			statements.push(
				`CREATE INDEX IF NOT EXISTS ${quotePgIdent(`idx_${schemaName}_${tableName}_${colName}_trgm`)} ON ${qualifiedName} USING gin (${quotePgIdent(colName)} gin_trgm_ops)`,
			);
		}
	}

	// Composite indexes.
	if (tableDef.indexes) {
		for (let i = 0; i < tableDef.indexes.length; i++) {
			// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
			const cols = tableDef.indexes[i]!;
			const idxName = quotePgIdent(
				`idx_${schemaName}_${tableName}_composite_${i}`,
			);
			statements.push(
				`CREATE INDEX IF NOT EXISTS ${idxName} ON ${qualifiedName} (${cols.map(quotePgIdent).join(", ")})`,
			);
		}
	}

	// Unique constraints (required for upsert ON CONFLICT).
	if (tableDef.uniqueKeys) {
		for (let i = 0; i < tableDef.uniqueKeys.length; i++) {
			// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
			const cols = tableDef.uniqueKeys[i]!;
			const constraintName = quotePgIdent(
				`uq_${schemaName}_${tableName}_${cols.join("_")}`,
			);
			statements.push(
				`ALTER TABLE ${qualifiedName} ADD CONSTRAINT ${constraintName} UNIQUE (${cols.map(quotePgIdent).join(", ")})`,
			);
		}
	}

	return statements;
}

/**
 * Per-schema revert journal. Before every keyed mutation (upsert / increment /
 * update / delete) the flush records the row's prior state; a reorg restores
 * those states instead of deleting whole rows by `_block_height` — which is
 * only correct for append-only tables, not accumulators (fix-f040 B2).
 * `prev_row IS NULL` marks a row first created by the journaled op.
 */
export function emitJournalDDL(schemaName: string): string[] {
	return [
		`CREATE TABLE IF NOT EXISTS ${schemaName}._journal (
  _jid BIGSERIAL PRIMARY KEY,
  block_height BIGINT NOT NULL,
  table_name TEXT NOT NULL,
  row_key JSONB NOT NULL,
  prev_row JSONB,
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
		`CREATE INDEX IF NOT EXISTS idx_${schemaName}_journal_height ON ${schemaName}._journal (block_height)`,
	];
}

/**
 * Storage for factory-discovered addresses.
 *
 * `block_height` is what makes the set reorg-scoped: the reorg handler
 * deletes rows at or above the fork alongside the data tables, so an address
 * revealed on an orphaned chain does not linger in the matcher forever
 * (the failure mode a set kept outside the rollback model would have).
 */
export function emitFactoryDDL(schemaName: string): string[] {
	return [
		`CREATE TABLE IF NOT EXISTS ${schemaName}._factory_addresses (
  source_name TEXT NOT NULL,
  address TEXT NOT NULL,
  block_height BIGINT NOT NULL,
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_name, address)
)`,
		`CREATE INDEX IF NOT EXISTS idx_${schemaName}_factory_height ON ${schemaName}._factory_addresses (block_height)`,
	];
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

	// Revert journal (one per schema) — see emitJournalDDL.
	statements.push(...emitJournalDDL(schemaName));
	// Only when a source actually uses a factory — no dead table otherwise.
	if (
		Object.values(def.sources ?? {}).some(
			(src) => (src as { factory?: unknown }).factory !== undefined,
		)
	) {
		statements.push(...emitFactoryDDL(schemaName));
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
