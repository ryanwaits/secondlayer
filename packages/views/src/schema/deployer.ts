import { sql, type Kysely } from "kysely";
import type { Database } from "@secondlayer/shared/db";
import { validateViewDefinition } from "../validate.ts";
import { generateViewSQL, TYPE_MAP } from "./generator.ts";
import { pgSchemaName } from "./utils.ts";
import type { ViewDefinition, ViewSchema } from "../types.ts";

type AnyDb = Kysely<Database>;

/** Deep-clone an object, converting BigInts to strings for JSON serialization. */
function toJsonSafe(obj: unknown): unknown {
  return JSON.parse(JSON.stringify(obj, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  ));
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
 * Compare two multi-table view schemas and return differences.
 */
export function diffSchema(existing: ViewSchema, incoming: ViewSchema): TableDiff {
  const existingTables = new Set(Object.keys(existing));
  const incomingTables = new Set(Object.keys(incoming));

  const addedTables = [...incomingTables].filter((t) => !existingTables.has(t));
  const removedTables = [...existingTables].filter((t) => !incomingTables.has(t));

  const tables: Record<string, ColumnDiff> = {};
  for (const tableName of incomingTables) {
    if (!existingTables.has(tableName)) continue;
    const existingCols = existing[tableName]!.columns;
    const incomingCols = incoming[tableName]!.columns;

    const existingKeys = new Set(Object.keys(existingCols));
    const incomingKeys = new Set(Object.keys(incomingCols));

    tables[tableName] = {
      added: [...incomingKeys].filter((k) => !existingKeys.has(k)),
      removed: [...existingKeys].filter((k) => !incomingKeys.has(k)),
      changed: [...incomingKeys].filter((k) => {
        if (!existingKeys.has(k)) return false;
        return JSON.stringify(existingCols[k]) !== JSON.stringify(incomingCols[k]);
      }),
    };
  }

  return { addedTables, removedTables, tables };
}

/**
 * Returns true if the diff contains any breaking changes
 * (removed tables, removed columns, or changed column types).
 */
function hasBreakingChanges(diff: TableDiff): { breaking: boolean; reasons: string[] } {
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

/**
 * Deploy a view schema to the database.
 * - New view → CREATE SCHEMA + tables + register
 * - Same hash → no-op
 * - Additive change → ALTER TABLE ADD COLUMN / CREATE TABLE for new tables
 * - Breaking change → throws error
 */
export async function deploySchema(
  db: AnyDb,
  def: ViewDefinition,
  handlerPath: string,
  opts?: { forceReindex?: boolean; apiKeyId?: string; schemaName?: string },
): Promise<{ action: "created" | "unchanged" | "updated" | "reindexed"; viewId: string }> {
  validateViewDefinition(def);

  const { statements, hash } = generateViewSQL(def, opts?.schemaName);
  const { getView, registerView } = await import("@secondlayer/shared/db/queries/views");

  const existing = await getView(db, def.name, opts?.apiKeyId);

  const schemaName = opts?.schemaName ?? pgSchemaName(def.name);
  const regData = {
    name: def.name,
    version: def.version || "1.0.0",
    definition: toJsonSafe({ name: def.name, version: def.version, description: def.description, sources: def.sources, schema: def.schema }) as Record<string, unknown>,
    schemaHash: hash,
    handlerPath,
    apiKeyId: opts?.apiKeyId,
    schemaName,
  };

  if (existing) {
    if (existing.schema_hash === hash && !opts?.forceReindex) {
      // Update handler path in case file moved
      const { updateViewHandlerPath } = await import("@secondlayer/shared/db/queries/views");
      await updateViewHandlerPath(db, def.name, handlerPath);
      return { action: "unchanged", viewId: existing.id };
    }

    if (existing.schema_hash === hash && opts?.forceReindex) {
      // Same schema but force reindex requested — drop and recreate
      await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
      for (const stmt of statements) {
        await sql.raw(stmt).execute(db);
      }
      const view = await registerView(db, regData);
      return { action: "reindexed", viewId: view.id };
    }

    const existingDef = existing.definition as { schema?: ViewSchema };
    if (existingDef.schema) {
      const diff = diffSchema(existingDef.schema, def.schema);
      const { breaking, reasons } = hasBreakingChanges(diff);

      if (breaking) {
        if (!opts?.forceReindex) {
          throw new Error(
            `Breaking schema change detected (${reasons.join("; ")}). ` +
            `Use --reindex to force rebuild, or delete the view first.`,
          );
        }

        // Force reindex: drop schema, recreate, register, caller triggers reindex
        await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
        for (const stmt of statements) {
          await sql.raw(stmt).execute(db);
        }
        const view = await registerView(db, regData);
        return { action: "reindexed", viewId: view.id };
      }

      // Create new tables
      for (const tableName of diff.addedTables) {
        const tableDef = def.schema[tableName]!;
        const qualifiedName = `${schemaName}.${tableName}`;
        const colDefs = [
          `_id BIGSERIAL PRIMARY KEY`,
          `_block_height BIGINT NOT NULL`,
          `_tx_id TEXT NOT NULL`,
          `_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
        ];
        for (const [colName, col] of Object.entries(tableDef.columns)) {
          const nullable = col.nullable ? "" : " NOT NULL";
          colDefs.push(`${colName} ${TYPE_MAP[col.type]!}${nullable}`);
        }
        await sql.raw(
          `CREATE TABLE IF NOT EXISTS ${qualifiedName} (\n  ${colDefs.join(",\n  ")}\n)`,
        ).execute(db);
        await sql.raw(
          `CREATE INDEX IF NOT EXISTS idx_${schemaName}_${tableName}_block_height ON ${qualifiedName} (_block_height)`,
        ).execute(db);
        await sql.raw(
          `CREATE INDEX IF NOT EXISTS idx_${schemaName}_${tableName}_tx_id ON ${qualifiedName} (_tx_id)`,
        ).execute(db);
        for (const [colName, col] of Object.entries(tableDef.columns)) {
          if (col.indexed) {
            await sql.raw(
              `CREATE INDEX IF NOT EXISTS idx_${schemaName}_${tableName}_${colName} ON ${qualifiedName} (${colName})`,
            ).execute(db);
          }
        }
      }

      // Add columns to existing tables
      for (const [tableName, colDiff] of Object.entries(diff.tables)) {
        if (colDiff.added.length === 0) continue;
        const qualifiedName = `${schemaName}.${tableName}`;
        const tableDef = def.schema[tableName]!;
        for (const colName of colDiff.added) {
          const col = tableDef.columns[colName]!;
          const sqlType = TYPE_MAP[col.type]!;
          const nullable = col.nullable ? "" : " NOT NULL DEFAULT " + getDefault(col.type);
          await sql.raw(
            `ALTER TABLE ${qualifiedName} ADD COLUMN ${colName} ${sqlType}${nullable}`,
          ).execute(db);
          if (col.indexed) {
            await sql.raw(
              `CREATE INDEX IF NOT EXISTS idx_${schemaName}_${tableName}_${colName} ON ${qualifiedName} (${colName})`,
            ).execute(db);
          }
        }
      }
    }

    const view = await registerView(db, regData);
    return { action: "updated", viewId: view.id };
  }

  // New view — execute all DDL
  for (const stmt of statements) {
    await sql.raw(stmt).execute(db);
  }

  const view = await registerView(db, regData);
  return { action: "created", viewId: view.id };
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
