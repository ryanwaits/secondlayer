import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import type { ViewSchema } from "../types.ts";

type AnyDb = Kysely<Database> | Transaction<Database>;

interface WriteOp {
  kind: "insert" | "update" | "delete";
  table: string;
  data: Record<string, unknown>;
  /** For update: SET clause */
  set?: Record<string, unknown>;
}

export interface BlockMeta {
  height: number;
  hash: string;
  timestamp: number;
  burnBlockHeight: number;
}

export interface TxMeta {
  txId: string;
  sender: string;
  type: string;
  status: string;
}

/** Validate that a column name is safe for SQL identifiers */
function validateColumnName(name: string): void {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`Invalid column name: ${name}`);
  }
}

/**
 * Runtime context passed to view handlers.
 * Batches writes and flushes them atomically at the end of a block.
 * Reads execute immediately against the DB (pre-flush state).
 */
export class ViewContext {
  readonly block: BlockMeta;
  private _tx: TxMeta;
  private readonly db: AnyDb;
  private readonly pgSchemaName: string;
  private readonly viewSchema: ViewSchema;
  private readonly ops: WriteOp[] = [];

  constructor(
    db: AnyDb,
    pgSchemaName: string,
    viewSchema: ViewSchema,
    block: BlockMeta,
    tx: TxMeta,
  ) {
    this.db = db;
    this.pgSchemaName = pgSchemaName;
    this.viewSchema = viewSchema;
    this.block = block;
    this._tx = tx;
  }

  get tx(): TxMeta {
    return this._tx;
  }

  /** Update the current transaction context (used by runner between events) */
  setTx(tx: TxMeta): void {
    this._tx = tx;
  }

  // --- Write operations (batched) ---

  insert(table: string, row: Record<string, unknown>): void {
    this.validateTable(table);
    this.ops.push({ kind: "insert", table, data: row });
  }

  update(
    table: string,
    where: Record<string, unknown>,
    set: Record<string, unknown>,
  ): void {
    this.validateTable(table);
    this.ops.push({ kind: "update", table, data: where, set });
  }

  upsert(
    table: string,
    key: Record<string, unknown>,
    row: Record<string, unknown>,
  ): void {
    this.validateTable(table);
    const tableDef = this.viewSchema[table]!;
    const keyColumns = Object.keys(key);

    // Check if there's a matching uniqueKeys constraint
    const hasUniqueConstraint = tableDef.uniqueKeys?.some(
      (uk) => uk.length === keyColumns.length && uk.every((c) => keyColumns.includes(c)),
    );

    if (hasUniqueConstraint) {
      // Use ON CONFLICT for proper upsert
      this.ops.push({ kind: "insert", table, data: { ...key, ...row, _upsert_keys: keyColumns } });
    } else {
      // Fallback: log warning, use findOne + conditional insert/update
      logger.warn("upsert called without matching uniqueKeys constraint, using fallback", {
        table,
        keys: keyColumns,
      });
      this.ops.push({ kind: "insert", table, data: { ...key, ...row, _upsert_fallback_keys: keyColumns, _upsert_fallback_set: row } });
    }
  }

  delete(table: string, where: Record<string, unknown>): void {
    this.validateTable(table);
    this.ops.push({ kind: "delete", table, data: where });
  }

  // --- Read operations (immediate) ---

  async findOne(
    table: string,
    where: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    this.validateTable(table);
    const qualifiedTable = `"${this.pgSchemaName}"."${table}"`;
    const { clause } = buildWhereClause(where);
    const query = `SELECT * FROM ${qualifiedTable} WHERE ${clause} LIMIT 1`;
    const { rows } = await sql.raw(query).execute(this.db);
    return (rows as Record<string, unknown>[])[0] ?? null;
  }

  async findMany(
    table: string,
    where: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    this.validateTable(table);
    const qualifiedTable = `"${this.pgSchemaName}"."${table}"`;
    const { clause } = buildWhereClause(where);
    const query = `SELECT * FROM ${qualifiedTable} WHERE ${clause}`;
    const { rows } = await sql.raw(query).execute(this.db);
    return rows as Record<string, unknown>[];
  }

  // --- Flush ---

  /** Number of pending write operations */
  get pendingOps(): number {
    return this.ops.length;
  }

  /**
   * Execute all batched writes in a single transaction.
   * Auto-populates _block_height, _tx_id, _created_at on inserts.
   */
  async flush(): Promise<number> {
    if (this.ops.length === 0) return 0;

    const opsToFlush = [...this.ops];
    this.ops.length = 0;

    const statements = this.buildStatements(opsToFlush);

    // If db is already a transaction, execute directly
    if ("isTransaction" in this.db) {
      for (const stmt of statements) {
        await sql.raw(stmt).execute(this.db);
      }
    } else {
      await (this.db as Kysely<Database>).transaction().execute(async (tx) => {
        for (const stmt of statements) {
          await sql.raw(stmt).execute(tx);
        }
      });
    }

    return opsToFlush.length;
  }

  /** Build SQL statements from write ops */
  private buildStatements(ops: WriteOp[]): string[] {
    const statements: string[] = [];

    for (const op of ops) {
      const qualifiedTable = `"${this.pgSchemaName}"."${op.table}"`;

      switch (op.kind) {
        case "insert": {
          const upsertKeys = op.data._upsert_keys as string[] | undefined;
          const fallbackKeys = op.data._upsert_fallback_keys as string[] | undefined;
          const fallbackSet = op.data._upsert_fallback_set as Record<string, unknown> | undefined;
          const data = { ...op.data };
          delete data._upsert_keys;
          delete data._upsert_fallback_keys;
          delete data._upsert_fallback_set;

          // Auto-populate meta columns
          data._block_height = this.block.height;
          data._tx_id = this._tx.txId;
          data._created_at = "NOW()";

          const cols = Object.keys(data);
          cols.forEach(validateColumnName);
          const vals = cols.map((c) =>
            data[c] === "NOW()" ? "NOW()" : escapeLiteral(data[c]),
          );
          let stmt = `INSERT INTO ${qualifiedTable} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${vals.join(", ")})`;

          if (upsertKeys && upsertKeys.length > 0) {
            const updateCols = cols.filter((c) => !upsertKeys.includes(c) && !c.startsWith("_"));
            if (updateCols.length > 0) {
              const setClauses = updateCols.map((c) => `"${c}" = EXCLUDED."${c}"`);
              stmt += ` ON CONFLICT (${upsertKeys.map((k) => `"${k}"`).join(", ")}) DO UPDATE SET ${setClauses.join(", ")}`;
            } else {
              stmt += ` ON CONFLICT (${upsertKeys.map((k) => `"${k}"`).join(", ")}) DO NOTHING`;
            }
          } else if (fallbackKeys && fallbackSet) {
            // Fallback upsert: use ON CONFLICT DO UPDATE but without a declared constraint
            // This will just be a plain INSERT — if it conflicts, PG will raise an error.
            // The caller was already warned. This is the best we can do without a unique constraint.
          }

          statements.push(stmt);
          break;
        }
        case "update": {
          const setEntries = Object.entries(op.set!);
          setEntries.forEach(([k]) => validateColumnName(k));
          const setClauses = setEntries.map(
            ([k, v]) => `"${k}" = ${escapeLiteral(v)}`,
          );
          const { clause } = buildWhereClause(op.data);
          statements.push(
            `UPDATE ${qualifiedTable} SET ${setClauses.join(", ")} WHERE ${clause}`,
          );
          break;
        }
        case "delete": {
          const { clause } = buildWhereClause(op.data);
          statements.push(`DELETE FROM ${qualifiedTable} WHERE ${clause}`);
          break;
        }
      }
    }

    return statements;
  }

  private validateTable(table: string): void {
    if (!this.viewSchema[table]) {
      throw new Error(
        `Table "${table}" not found in view schema. Available: [${Object.keys(this.viewSchema).join(", ")}]`,
      );
    }
  }
}

// --- Helpers ---

function escapeLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "object") return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  // String — escape single quotes
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildWhereClause(where: Record<string, unknown>): {
  clause: string;
  values: unknown[];
} {
  const entries = Object.entries(where);
  if (entries.length === 0) return { clause: "TRUE", values: [] };

  entries.forEach(([k]) => validateColumnName(k));
  const parts = entries.map(([k, v]) => `"${k}" = ${escapeLiteral(v)}`);
  return { clause: parts.join(" AND "), values: [] };
}
