import type { Database } from "@secondlayer/shared/db";
import { type Kysely, sql } from "kysely";
import type { SubgraphDefinition, SubgraphSchema } from "../types.ts";
import { validateSubgraphDefinition } from "../validate.ts";
import { TYPE_MAP, generateSubgraphSQL } from "./generator.ts";
import { pgSchemaName } from "./utils.ts";

type AnyDb = Kysely<Database>;

/** Deep-clone an object, converting BigInts to strings for JSON serialization. */
function toJsonSafe(obj: unknown): unknown {
	return JSON.parse(
		JSON.stringify(obj, (_key, value) =>
			typeof value === "bigint" ? value.toString() : value,
		),
	);
}

export interface TableDiff {
	/** Tables added to the schema */
	addedTables: string[];
	/** Tables removed from the schema */
	removedTables: string[];
	/** Per-table column diffs (only for tables present in both) */
	tables: Record<string, ColumnDiff>;
}

export interface ColumnDiff {
	added: string[];
	removed: string[];
	changed: string[];
}

/**
 * Compare two multi-table subgraph schemas and return differences.
 */
export function diffSchema(
	existing: SubgraphSchema,
	incoming: SubgraphSchema,
): TableDiff {
	const existingTables = new Set(Object.keys(existing));
	const incomingTables = new Set(Object.keys(incoming));

	const addedTables = [...incomingTables].filter((t) => !existingTables.has(t));
	const removedTables = [...existingTables].filter(
		(t) => !incomingTables.has(t),
	);

	const tables: Record<string, ColumnDiff> = {};
	for (const tableName of incomingTables) {
		if (!existingTables.has(tableName)) continue;
		const existingCols = existing[tableName]?.columns;
		const incomingCols = incoming[tableName]?.columns;

		const existingKeys = new Set(Object.keys(existingCols));
		const incomingKeys = new Set(Object.keys(incomingCols));

		tables[tableName] = {
			added: [...incomingKeys].filter((k) => !existingKeys.has(k)),
			removed: [...existingKeys].filter((k) => !incomingKeys.has(k)),
			changed: [...incomingKeys].filter((k) => {
				if (!existingKeys.has(k)) return false;
				const sortedStringify = (o: unknown) =>
					JSON.stringify(o, Object.keys(o as object).sort());
				return (
					sortedStringify(existingCols[k]) !== sortedStringify(incomingCols[k])
				);
			}),
		};
	}

	return { addedTables, removedTables, tables };
}

/**
 * Returns true if the diff contains any breaking changes
 * (removed tables, removed columns, or changed column types).
 */
function hasBreakingChanges(diff: TableDiff): {
	breaking: boolean;
	reasons: string[];
} {
	const reasons: string[] = [];
	if (diff.removedTables.length > 0) {
		reasons.push(`removed tables: [${diff.removedTables.join(", ")}]`);
	}
	for (const [table, colDiff] of Object.entries(diff.tables)) {
		if (colDiff.removed.length > 0) {
			reasons.push(`${table}: removed columns [${colDiff.removed.join(", ")}]`);
		}
		if (colDiff.changed.length > 0) {
			reasons.push(`${table}: changed columns [${colDiff.changed.join(", ")}]`);
		}
	}
	return { breaking: reasons.length > 0, reasons };
}

/** Increment the patch segment of a semver string. "1.0.2" → "1.0.3" */
function bumpPatch(version: string): string {
	const parts = version.split(".");
	if (parts.length !== 3) return "1.0.1";
	const patch = Number.parseInt(parts[2] ?? "0", 10);
	return `${parts[0]}.${parts[1]}.${Number.isNaN(patch) ? 1 : patch + 1}`;
}

export interface DeployDiff {
	addedTables: string[];
	removedTables: string[];
	addedColumns: Record<string, string[]>;
	breakingChanges: string[];
}

/**
 * Deploy a subgraph schema to the database.
 * - New subgraph → CREATE SCHEMA + tables + register
 * - Same hash → no-op (handler path updated)
 * - Additive change → ALTER TABLE ADD COLUMN / CREATE TABLE for new tables
 * - Breaking change → auto-reindex (drop + recreate)
 */
export async function deploySchema(
	db: AnyDb,
	def: SubgraphDefinition,
	handlerPath: string,
	opts?: {
		forceReindex?: boolean;
		apiKeyId?: string;
		accountId?: string;
		schemaName?: string;
		version?: string;
		handlerCode?: string;
	},
): Promise<{
	action: "created" | "unchanged" | "updated" | "reindexed";
	subgraphId: string;
	version: string;
	diff?: DeployDiff;
}> {
	validateSubgraphDefinition(def);

	const { statements, hash } = generateSubgraphSQL(def, opts?.schemaName);
	const { getSubgraph, registerSubgraph } = await import(
		"@secondlayer/shared/db/queries/subgraphs"
	);

	const existing = await getSubgraph(db, def.name, opts?.accountId);

	const schemaName = opts?.schemaName ?? pgSchemaName(def.name);

	// Server owns versioning: use explicit flag, bump patch from existing, or start at 1.0.0
	const newVersion =
		opts?.version ?? (existing ? bumpPatch(existing.version) : "1.0.0");

	const regData = {
		name: def.name,
		version: newVersion,
		definition: toJsonSafe({
			name: def.name,
			version: def.version,
			description: def.description,
			startBlock: def.startBlock,
			sources: def.sources,
			schema: def.schema,
		}) as Record<string, unknown>,
		schemaHash: hash,
		handlerPath,
		apiKeyId: opts?.apiKeyId,
		accountId: opts?.accountId,
		handlerCode: opts?.handlerCode,
		schemaName,
		startBlock: def.startBlock,
	};

	if (existing) {
		if (existing.schema_hash === hash && !opts?.forceReindex) {
			// Update handler path in case file moved
			const { updateSubgraphHandlerPath } = await import(
				"@secondlayer/shared/db/queries/subgraphs"
			);
			await updateSubgraphHandlerPath(db, def.name, handlerPath);
			return {
				action: "unchanged",
				subgraphId: existing.id,
				version: existing.version,
			};
		}

		if (existing.schema_hash === hash && opts?.forceReindex) {
			// Same schema but force reindex requested — drop and recreate
			await sql
				.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
				.execute(db);
			for (const stmt of statements) {
				await sql.raw(stmt).execute(db);
			}
			const sg = await registerSubgraph(db, regData);
			return { action: "reindexed", subgraphId: sg.id, version: newVersion };
		}

		if (existing.definition.schema) {
			const diff = diffSchema(
				existing.definition.schema as SubgraphSchema,
				def.schema,
			);
			const { breaking, reasons } = hasBreakingChanges(diff);

			if (breaking || opts?.forceReindex) {
				// Breaking change or forced: drop schema, recreate, register
				await sql
					.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
					.execute(db);
				for (const stmt of statements) {
					await sql.raw(stmt).execute(db);
				}
				const sg = await registerSubgraph(db, regData);
				const deployDiff: DeployDiff = {
					addedTables: diff.addedTables,
					removedTables: diff.removedTables,
					addedColumns: Object.fromEntries(
						Object.entries(diff.tables)
							.filter(([, c]) => c.added.length > 0)
							.map(([t, c]) => [t, c.added]),
					),
					breakingChanges: reasons,
				};
				return {
					action: "reindexed",
					subgraphId: sg.id,
					version: newVersion,
					diff: deployDiff,
				};
			}

			// Create new tables
			for (const tableName of diff.addedTables) {
				const tableDef = def.schema[tableName];
				if (!tableDef) continue;
				const qualifiedName = `${schemaName}.${tableName}`;
				const colDefs = [
					"_id BIGSERIAL PRIMARY KEY",
					"_block_height BIGINT NOT NULL",
					"_tx_id TEXT NOT NULL",
					"_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
				];
				for (const [colName, col] of Object.entries(tableDef.columns)) {
					const nullable = col.nullable ? "" : " NOT NULL";
					const sqlType = TYPE_MAP[col.type];
					if (!sqlType) continue;
					colDefs.push(`${colName} ${sqlType}${nullable}`);
				}
				await sql
					.raw(
						`CREATE TABLE IF NOT EXISTS ${qualifiedName} (\n  ${colDefs.join(",\n  ")}\n)`,
					)
					.execute(db);
				await sql
					.raw(
						`CREATE INDEX IF NOT EXISTS idx_${schemaName}_${tableName}_block_height ON ${qualifiedName} (_block_height)`,
					)
					.execute(db);
				await sql
					.raw(
						`CREATE INDEX IF NOT EXISTS idx_${schemaName}_${tableName}_tx_id ON ${qualifiedName} (_tx_id)`,
					)
					.execute(db);
				for (const [colName, col] of Object.entries(tableDef.columns)) {
					if (col.indexed) {
						await sql
							.raw(
								`CREATE INDEX IF NOT EXISTS idx_${schemaName}_${tableName}_${colName} ON ${qualifiedName} (${colName})`,
							)
							.execute(db);
					}
					if (col.search) {
						await sql
							.raw(
								`CREATE INDEX IF NOT EXISTS idx_${schemaName}_${tableName}_${colName}_trgm ON ${qualifiedName} USING gin (${colName} gin_trgm_ops)`,
							)
							.execute(db);
					}
				}
			}

			// Add columns to existing tables
			for (const [tableName, colDiff] of Object.entries(diff.tables)) {
				if (colDiff.added.length === 0) continue;
				const qualifiedName = `${schemaName}.${tableName}`;
				const tableDef = def.schema[tableName];
				if (!tableDef) continue;
				for (const colName of colDiff.added) {
					const col = tableDef.columns[colName];
					if (!col) continue;
					const sqlType = TYPE_MAP[col.type];
					if (!sqlType) continue;
					const nullable = col.nullable
						? ""
						: ` NOT NULL DEFAULT ${getDefault(col.type)}`;
					await sql
						.raw(
							`ALTER TABLE ${qualifiedName} ADD COLUMN ${colName} ${sqlType}${nullable}`,
						)
						.execute(db);
					if (col.indexed) {
						await sql
							.raw(
								`CREATE INDEX IF NOT EXISTS idx_${schemaName}_${tableName}_${colName} ON ${qualifiedName} (${colName})`,
							)
							.execute(db);
					}
					if (col.search) {
						await sql
							.raw(
								`CREATE INDEX IF NOT EXISTS idx_${schemaName}_${tableName}_${colName}_trgm ON ${qualifiedName} USING gin (${colName} gin_trgm_ops)`,
							)
							.execute(db);
					}
				}
			}

			const sg = await registerSubgraph(db, regData);
			const addedCols: Record<string, string[]> = {};
			for (const [t, colDiff] of Object.entries(diff.tables)) {
				if ((colDiff as ColumnDiff).added.length > 0)
					addedCols[t] = (colDiff as ColumnDiff).added;
			}
			const deployDiff: DeployDiff = {
				addedTables: diff.addedTables,
				removedTables: [],
				addedColumns: addedCols,
				breakingChanges: [],
			};
			return {
				action: "updated",
				subgraphId: sg.id,
				version: newVersion,
				diff: deployDiff,
			};
		}
	}

	// New subgraph — execute all DDL
	for (const stmt of statements) {
		await sql.raw(stmt).execute(db);
	}

	const sg = await registerSubgraph(db, regData);
	return { action: "created", subgraphId: sg.id, version: newVersion };
}

function getDefault(type: string): string {
	switch (type) {
		case "text":
		case "principal":
			return "''";
		case "uint":
		case "int":
			return "0";
		case "boolean":
			return "false";
		case "timestamp":
			return "NOW()";
		case "jsonb":
			return "'{}'";
		default:
			return "''";
	}
}
