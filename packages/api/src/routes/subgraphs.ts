import { Hono } from "hono";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { getDb, getRawClient } from "@secondlayer/shared/db";
import { getErrorMessage } from "@secondlayer/shared";
import { listSubgraphs, pgSchemaName } from "@secondlayer/shared/db/queries/subgraphs";
import { DeploySubgraphRequestSchema } from "@secondlayer/shared/schemas/subgraphs";
import type { Subgraph } from "@secondlayer/shared/db";
import type { SubgraphSchema, SubgraphColumn } from "@secondlayer/subgraphs/types";
import { SubgraphRegistryCache } from "../subgraphs/cache.ts";
import { getApiKeyId, resolveKeyIds } from "../lib/ownership.ts";
import { enforceLimits } from "../middleware/enforce-limits.ts";
import { InvalidJSONError } from "../middleware/error.ts";

const app = new Hono();

// Enforce subgraph creation limit
app.post("/", enforceLimits("subgraphs"));

// Subgraph registry cache — auto-refreshes via PG NOTIFY
const cache = new SubgraphRegistryCache(async () => {
  const db = getDb();
  return listSubgraphs(db);
});

/** Start the cache listener. Call once on API startup. */
export async function startSubgraphCache(): Promise<void> {
  await cache.start();
}

/** Stop the cache listener. Call on API shutdown. */
export async function stopSubgraphCache(): Promise<void> {
  await cache.stop();
}

// ── Helpers ─────────────────────────────────────────────────────────────

const SYSTEM_COLUMNS = new Set(["_id", "_block_height", "_tx_id", "_created_at"]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;

const COMPARISON_OPS: Record<string, string> = {
  gte: ">=",
  lte: "<=",
  gt: ">",
  lt: "<",
  neq: "!=",
  like: "ILIKE",
};

function ident(name: string): string {
  if (!/^[a-z0-9_]+$/i.test(name)) {
    throw new Error(`Invalid identifier: ${name}`);
  }
  return `"${name}"`;
}

/** Get the PG schema name for a subgraph, preferring stored schema_name */
function subgraphSchemaName(subgraph: Subgraph): string {
  return subgraph.schema_name ?? pgSchemaName(subgraph.name);
}

function getValidColumns(table: { columns: Record<string, SubgraphColumn> }): Set<string> {
  const cols = new Set(Object.keys(table.columns));
  for (const sc of SYSTEM_COLUMNS) cols.add(sc);
  return cols;
}

function getSubgraphSchema(subgraph: Subgraph): SubgraphSchema {
  return (subgraph.definition.schema as SubgraphSchema) ?? {};
}

class InvalidColumnError extends Error {
  constructor(column: string) {
    super(`Unknown column: ${column}`);
  }
}

interface ParsedQuery {
  filters: { column: string; op: string; value: string; isLike?: boolean }[];
  sort?: string;
  order: "ASC" | "DESC";
  limit: number;
  offset: number;
  fields?: string[];
  search?: { value: string; columns: string[] };
}

function parseQueryParams(
  params: Record<string, string>,
  validColumns: Set<string>,
  tableDef?: { columns: Record<string, SubgraphColumn> },
): ParsedQuery {
  const filters: ParsedQuery["filters"] = [];
  let sort: string | undefined;
  let order: "ASC" | "DESC" = "ASC";
  let limit = DEFAULT_LIMIT;
  let offset = 0;
  let fields: string[] | undefined;
  let search: ParsedQuery["search"];

  for (const [key, value] of Object.entries(params)) {
    if (key === "_search") {
      const searchCols = tableDef
        ? Object.entries(tableDef.columns)
            .filter(([, col]) => col.search)
            .map(([name]) => name)
        : [];
      if (searchCols.length > 0) {
        search = { value, columns: searchCols };
      }
      continue;
    }
    if (key === "_sort") {
      if (!validColumns.has(value)) throw new InvalidColumnError(value);
      sort = value;
      continue;
    }
    if (key === "_order") {
      order = value.toLowerCase() === "desc" ? "DESC" : "ASC";
      continue;
    }
    if (key === "_limit") {
      limit = Math.min(Math.max(1, parseInt(value, 10) || DEFAULT_LIMIT), MAX_LIMIT);
      continue;
    }
    if (key === "_offset") {
      offset = Math.max(0, parseInt(value, 10) || 0);
      continue;
    }
    if (key === "_fields") {
      fields = value.split(",").map((f) => f.trim());
      for (const f of fields) {
        if (!validColumns.has(f)) throw new InvalidColumnError(f);
      }
      continue;
    }

    // Comparison operators: column.op=value
    const dotIdx = key.lastIndexOf(".");
    if (dotIdx > 0) {
      const col = key.slice(0, dotIdx);
      const op = key.slice(dotIdx + 1);
      if (COMPARISON_OPS[op]) {
        if (!validColumns.has(col)) throw new InvalidColumnError(col);
        filters.push({ column: col, op: COMPARISON_OPS[op]!, value, isLike: op === "like" });
        continue;
      }
    }

    // Equality filter
    if (!validColumns.has(key)) throw new InvalidColumnError(key);
    filters.push({ column: key, op: "=", value });
  }

  return { filters, sort, order, limit, offset, fields, search };
}

async function query(text: string, params: unknown[] = []) {
  const client = getRawClient();
  return client.unsafe(text, params as any[]);
}

class SubgraphNotFoundError extends Error {
  code = "SUBGRAPH_NOT_FOUND";
  constructor(subgraphName: string) {
    super(`Subgraph not found: ${subgraphName}`);
    this.name = "SubgraphNotFoundError";
  }
}

/** Look up a subgraph from cache with account-level ownership check */
function getOwnedSubgraph(subgraphName: string, keyIds: string[] | undefined): Subgraph {
  const subgraph = cache.get(subgraphName, keyIds);
  if (!subgraph) {
    throw new SubgraphNotFoundError(subgraphName);
  }
  return subgraph;
}

// ── Deploy a subgraph ───────────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR ?? "./data";

app.post("/", async (c) => {
  const body = await c.req.json().catch(() => { throw new InvalidJSONError(); });

  const parsed = DeploySubgraphRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten().fieldErrors }, 400);
  }

  const { name, handlerCode, reindex } = parsed.data;
  const subgraphsDir = join(DATA_DIR, "subgraphs");
  if (!existsSync(subgraphsDir)) {
    mkdirSync(subgraphsDir, { recursive: true });
  }

  const handlerPath = join(subgraphsDir, `${name}.js`);
  await Bun.write(handlerPath, handlerCode);

  // Import the handler to get a full SubgraphDefinition with handler functions
  let def: any;
  try {
    const mod = await import(`${handlerPath}?t=${Date.now()}`);
    def = mod.default ?? mod;
  } catch (err) {
    return c.json({
      error: `Failed to load handler: ${getErrorMessage(err)}`,
    }, 400);
  }

  try {
    const { validateSubgraphDefinition } = await import("@secondlayer/subgraphs/validate");
    validateSubgraphDefinition(def);
  } catch (err) {
    return c.json({
      error: `Invalid subgraph definition: ${getErrorMessage(err)}`,
    }, 400);
  }

  const apiKeyId = getApiKeyId(c);
  const apiKey = (c as any).get("apiKey");
  const keyPrefix = apiKey?.key_prefix;

  // Compute tenant-prefixed schema name
  const schemaName = keyPrefix ? pgSchemaName(name, keyPrefix) : pgSchemaName(name);

  const { deploySchema } = await import("@secondlayer/subgraphs");
  const db = getDb();
  const result = await deploySchema(db, def, handlerPath, {
    forceReindex: reindex,
    apiKeyId,
    schemaName,
  });

  await cache.refresh();

  const status = result.action === "created" ? 201 : 200;
  return c.json({
    action: result.action,
    subgraphId: result.subgraphId,
    message: `Subgraph "${name}" ${result.action}`,
  }, status);
});

// ── Reindex a subgraph ──────────────────────────────────────────────────

const MAX_CONCURRENT_OPERATIONS = 2;
let activeOperations = 0;
const activeSubgraphOps = new Set<string>();

app.post("/:subgraphName/reindex", async (c) => {
  const { subgraphName } = c.req.param();
  const keyIds = await resolveKeyIds(c);
  const subgraph = getOwnedSubgraph(subgraphName, keyIds);

  if (activeSubgraphOps.has(subgraphName)) {
    return c.json({
      error: `A reindex or backfill is already running for "${subgraphName}". Wait for it to complete.`,
      code: "OPERATION_IN_PROGRESS",
    }, 409);
  }

  if (activeOperations >= MAX_CONCURRENT_OPERATIONS) {
    return c.json({
      error: `Too many concurrent operations (max ${MAX_CONCURRENT_OPERATIONS}). Try again later.`,
      code: "OPERATION_LIMIT",
      activeOperations,
    }, 429);
  }

  const body = await c.req.json().catch(() => ({}));
  const fromBlock = typeof body.fromBlock === "number" ? body.fromBlock : undefined;
  const toBlock = typeof body.toBlock === "number" ? body.toBlock : undefined;

  activeOperations++;
  activeSubgraphOps.add(subgraphName);

  // Fire and forget — load handler + reindex runs in background
  (async () => {
    try {
      const { reindexSubgraph } = await import("@secondlayer/subgraphs");
      const mod = await import(subgraph.handler_path);
      const def = mod.default ?? mod;
      await reindexSubgraph(def, { fromBlock, toBlock, schemaName: subgraphSchemaName(subgraph) });
    } catch (err) {
      const msg = getErrorMessage(err);
      console.error(`Reindex failed for ${subgraphName}: ${msg}`);
    } finally {
      activeOperations--;
      activeSubgraphOps.delete(subgraphName);
    }
  })();

  return c.json({
    message: `Reindex started for subgraph "${subgraphName}"`,
    fromBlock: fromBlock ?? 1,
    toBlock: toBlock ?? "chain tip",
  });
});

// ── Backfill a subgraph (non-destructive) ────────────────────────────────

app.post("/:subgraphName/backfill", async (c) => {
  const { subgraphName } = c.req.param();
  const keyIds = await resolveKeyIds(c);
  const subgraph = getOwnedSubgraph(subgraphName, keyIds);

  if (activeSubgraphOps.has(subgraphName)) {
    return c.json({
      error: `A reindex or backfill is already running for "${subgraphName}". Wait for it to complete.`,
      code: "OPERATION_IN_PROGRESS",
    }, 409);
  }

  if (activeOperations >= MAX_CONCURRENT_OPERATIONS) {
    return c.json({
      error: `Too many concurrent operations (max ${MAX_CONCURRENT_OPERATIONS}). Try again later.`,
      code: "OPERATION_LIMIT",
      activeOperations,
    }, 429);
  }

  const body = await c.req.json().catch(() => ({}));
  const fromBlock = typeof body.fromBlock === "number" ? body.fromBlock : undefined;
  const toBlock = typeof body.toBlock === "number" ? body.toBlock : undefined;

  if (!fromBlock || !toBlock) {
    return c.json({ error: "Both fromBlock and toBlock are required for backfill", code: "VALIDATION_ERROR" }, 400);
  }

  activeOperations++;
  activeSubgraphOps.add(subgraphName);

  (async () => {
    try {
      const { backfillSubgraph } = await import("@secondlayer/subgraphs");
      const mod = await import(subgraph.handler_path);
      const def = mod.default ?? mod;
      await backfillSubgraph(def, { fromBlock, toBlock, schemaName: subgraphSchemaName(subgraph) });
    } catch (err) {
      const msg = getErrorMessage(err);
      console.error(`Backfill failed for ${subgraphName}: ${msg}`);
    } finally {
      activeOperations--;
      activeSubgraphOps.delete(subgraphName);
    }
  })();

  return c.json({
    message: `Backfill started for subgraph "${subgraphName}"`,
    fromBlock,
    toBlock,
  });
});

// ── Delete a subgraph ────────────────────────────────────────────────────

app.delete("/:subgraphName", async (c) => {
  const { subgraphName } = c.req.param();
  const apiKeyId = getApiKeyId(c);
  const keyIds = await resolveKeyIds(c);
  const subgraph = getOwnedSubgraph(subgraphName, keyIds);

  const db = getDb();
  const sn = subgraphSchemaName(subgraph);

  // Drop the subgraph's schema (all tables) and remove registry entry
  const client = getRawClient();
  await client.unsafe(`DROP SCHEMA IF EXISTS ${ident(sn)} CASCADE`);
  const { deleteSubgraph } = await import("@secondlayer/shared/db/queries/subgraphs");
  await deleteSubgraph(db, subgraphName, apiKeyId);

  // Clean up handler file if it exists
  if (subgraph.handler_path) {
    try { unlinkSync(subgraph.handler_path); } catch {}
  }

  // Refresh cache
  await cache.refresh();

  return c.json({ message: `Subgraph "${subgraphName}" deleted` });
});

// ── List all subgraphs ──────────────────────────────────────────────────

app.get("/", async (c) => {
  const keyIds = await resolveKeyIds(c);
  const allSubgraphs = cache.getAll(keyIds);

  // Fetch live stats from DB (cache may be stale for block progress)
  const db = getDb();
  const liveStats = new Map<string, { last_processed_block: number; total_processed: number; total_errors: number; status: string }>();
  try {
    const rows = await db
      .selectFrom("subgraphs")
      .select(["id", "last_processed_block", "total_processed", "total_errors", "status"])
      .execute();
    for (const r of rows) liveStats.set(r.id, r);
  } catch { /* fall back to cache values */ }

  return c.json({
    data: allSubgraphs.map((v) => {
      const live = liveStats.get(v.id);
      return {
        name: v.name,
        version: v.version,
        status: live?.status ?? v.status,
        lastProcessedBlock: live?.last_processed_block ?? v.last_processed_block,
        totalProcessed: live?.total_processed ?? v.total_processed,
        totalErrors: live?.total_errors ?? v.total_errors,
        tables: Object.keys(getSubgraphSchema(v)),
        createdAt: v.created_at.toISOString(),
      };
    }),
  });
});

// ── Subgraph metadata + docs ────────────────────────────────────────────

app.get("/:subgraphName", async (c) => {
  const { subgraphName } = c.req.param();
  const keyIds = await resolveKeyIds(c);
  const subgraph = getOwnedSubgraph(subgraphName, keyIds);

  const subgraphSchema = getSubgraphSchema(subgraph);
  const tables: Record<string, any> = {};
  const sn = subgraphSchemaName(subgraph);

  const schemaEntries = Object.entries(subgraphSchema);

  // Fetch live stats + COUNT queries in parallel
  const db = getDb();
  const [countResults, liveRow] = await Promise.all([
    Promise.allSettled(
      schemaEntries.map(([tableName]) =>
        query(`SELECT COUNT(*) as count FROM ${ident(sn)}.${ident(tableName)}`)
          .then((r) => parseInt(String(r[0]?.count ?? 0), 10))
      ),
    ),
    db.selectFrom("subgraphs")
      .select(["last_processed_block", "total_processed", "total_errors", "status", "last_error", "last_error_at", "updated_at"])
      .where("id", "=", subgraph.id)
      .executeTakeFirst()
      .catch(() => null),
  ]);

  for (let i = 0; i < schemaEntries.length; i++) {
    const [tableName, tableDef] = schemaEntries[i];
    const cr = countResults[i];
    const rowCount = cr.status === "fulfilled" ? cr.value : 0;

    const columns: Record<string, any> = {};
    for (const [colName, col] of Object.entries(tableDef.columns)) {
      columns[colName] = {
        type: col.type,
        ...(col.nullable && { nullable: true }),
        ...(col.indexed && { indexed: true }),
        ...(col.search && { searchable: true }),
        ...(col.default !== undefined && { default: col.default }),
      };
    }
    columns._id = { type: "serial" };
    columns._block_height = { type: "bigint" };
    columns._tx_id = { type: "text" };
    columns._created_at = { type: "timestamp" };

    tables[tableName] = {
      endpoint: `/subgraphs/${subgraphName}/${tableName}`,
      columns,
      rowCount,
      example: `/subgraphs/${subgraphName}/${tableName}?_sort=_block_height&_order=desc&_limit=10`,
      ...(tableDef.indexes && { indexes: tableDef.indexes }),
      ...(tableDef.uniqueKeys && { uniqueKeys: tableDef.uniqueKeys }),
    };
  }

  // Use live DB values for stats, fall back to cache
  const live = liveRow ?? subgraph;
  const totalProcessed = live.total_processed;
  const totalErrors = live.total_errors;
  const errorRate = totalProcessed > 0 ? totalErrors / totalProcessed : 0;

  const def = subgraph.definition as Record<string, unknown> | null;
  const sources = def?.sources ?? null;
  const description = def?.description ?? null;

  return c.json({
    name: subgraph.name,
    version: subgraph.version,
    status: live.status,
    lastProcessedBlock: live.last_processed_block,
    ...(description && { description }),
    ...(sources && { sources }),
    definition: def,
    health: {
      totalProcessed,
      totalErrors,
      errorRate: parseFloat(errorRate.toFixed(4)),
      lastError: live.last_error ?? null,
      lastErrorAt: live.last_error_at?.toISOString() ?? null,
    },
    tables,
    createdAt: subgraph.created_at.toISOString(),
    updatedAt: live.updated_at?.toISOString() ?? subgraph.updated_at.toISOString(),
  });
});

// ── Query helpers ────────────────────────────────────────────────────────

function buildWhereConditions(parsed: ParsedQuery, params: unknown[]): string[] {
  const conditions: string[] = [];

  for (const f of parsed.filters) {
    if (f.isLike) {
      params.push(f.value);
      conditions.push(`${ident(f.column)} ILIKE '%' || $${params.length} || '%'`);
    } else {
      params.push(f.value);
      conditions.push(`${ident(f.column)} ${f.op} $${params.length}`);
    }
  }

  if (parsed.search) {
    params.push(parsed.search.value);
    const idx = params.length;
    const orClauses = parsed.search.columns.map(
      (col) => `${ident(col)} ILIKE '%' || $${idx} || '%'`,
    );
    conditions.push(`(${orClauses.join(" OR ")})`);
  }

  return conditions;
}

// ── Count rows ──────────────────────────────────────────────────────────

app.get("/:subgraphName/:tableName/count", async (c) => {
  const { subgraphName, tableName } = c.req.param();
  const keyIds = await resolveKeyIds(c);
  const subgraph = getOwnedSubgraph(subgraphName, keyIds);

  const subgraphSchema = getSubgraphSchema(subgraph);
  const tableDef = subgraphSchema[tableName];
  if (!tableDef) {
    return c.json({ error: "Table not found", code: "TABLE_NOT_FOUND" }, 404);
  }

  const validColumns = getValidColumns(tableDef);

  try {
    const parsed = parseQueryParams(c.req.query(), validColumns, tableDef);
    const sn = subgraphSchemaName(subgraph);
    const params: unknown[] = [];
    let text = `SELECT COUNT(*) as count FROM ${ident(sn)}.${ident(tableName)}`;

    const conditions = buildWhereConditions(parsed, params);
    if (conditions.length > 0) {
      text += ` WHERE ${conditions.join(" AND ")}`;
    }

    const result = await query(text, params);
    return c.json({ count: parseInt(String(result[0]?.count ?? 0), 10) });
  } catch (e) {
    if (e instanceof InvalidColumnError) {
      return c.json({ error: e.message, code: "INVALID_COLUMN" }, 400);
    }
    throw e;
  }
});

// ── Get row by ID ───────────────────────────────────────────────────────

app.get("/:subgraphName/:tableName/:id", async (c) => {
  const { subgraphName, tableName, id } = c.req.param();
  if (id === "count") return;

  const keyIds = await resolveKeyIds(c);
  const subgraph = getOwnedSubgraph(subgraphName, keyIds);

  const subgraphSchema = getSubgraphSchema(subgraph);
  if (!subgraphSchema[tableName]) {
    return c.json({ error: "Table not found", code: "TABLE_NOT_FOUND" }, 404);
  }

  const sn = subgraphSchemaName(subgraph);
  const result = await query(
    `SELECT * FROM ${ident(sn)}.${ident(tableName)} WHERE "_id" = $1`,
    [parseInt(id, 10)],
  );

  if (!result[0]) {
    return c.json({ error: "Row not found", code: "ROW_NOT_FOUND" }, 404);
  }

  return c.json({ data: result[0] });
});

// ── List rows with filters ──────────────────────────────────────────────

app.get("/:subgraphName/:tableName", async (c) => {
  const { subgraphName, tableName } = c.req.param();
  const keyIds = await resolveKeyIds(c);
  const subgraph = getOwnedSubgraph(subgraphName, keyIds);

  const subgraphSchema = getSubgraphSchema(subgraph);
  const tableDef = subgraphSchema[tableName];
  if (!tableDef) {
    return c.json({ error: "Table not found", code: "TABLE_NOT_FOUND" }, 404);
  }

  const validColumns = getValidColumns(tableDef);

  try {
    const parsed = parseQueryParams(c.req.query(), validColumns, tableDef);
    const sn = subgraphSchemaName(subgraph);
    const params: unknown[] = [];

    const selectFields = parsed.fields
      ? parsed.fields.map((f) => ident(f)).join(", ")
      : "*";

    let text = `SELECT ${selectFields} FROM ${ident(sn)}.${ident(tableName)}`;

    const conditions = buildWhereConditions(parsed, params);
    if (conditions.length > 0) {
      text += ` WHERE ${conditions.join(" AND ")}`;
    }

    const sortCol = parsed.sort ? ident(parsed.sort) : '"_id"';
    text += ` ORDER BY ${sortCol} ${parsed.order}`;
    text += ` LIMIT ${parsed.limit} OFFSET ${parsed.offset}`;

    // Count query uses same params
    let countText = `SELECT COUNT(*) as count FROM ${ident(sn)}.${ident(tableName)}`;
    if (conditions.length > 0) {
      // Rebuild conditions with fresh params array for count query
      const countParams: unknown[] = [];
      const countConditions = buildWhereConditions(parsed, countParams);
      countText += ` WHERE ${countConditions.join(" AND ")}`;
      // Use countParams for count query
      const [data, countResult] = await Promise.all([
        query(text, params),
        query(countText, countParams),
      ]);

      return c.json({
        data: Array.from(data),
        meta: {
          total: parseInt(String(countResult[0]?.count ?? 0), 10),
          limit: parsed.limit,
          offset: parsed.offset,
        },
      });
    }

    const [data, countResult] = await Promise.all([
      query(text, params),
      query(countText),
    ]);

    return c.json({
      data: Array.from(data),
      meta: {
        total: parseInt(String(countResult[0]?.count ?? 0), 10),
        limit: parsed.limit,
        offset: parsed.offset,
      },
    });
  } catch (e) {
    if (e instanceof InvalidColumnError) {
      return c.json({ error: e.message, code: "INVALID_COLUMN" }, 400);
    }
    throw e;
  }
});

export default app;
