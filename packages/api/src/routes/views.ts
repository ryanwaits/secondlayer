import { Hono } from "hono";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { getDb, getRawClient } from "@secondlayer/shared/db";
import { listViews, pgSchemaName } from "@secondlayer/shared/db/queries/views";
import { DeployViewRequestSchema } from "@secondlayer/shared/schemas/views";
import type { View } from "@secondlayer/shared/db";
import type { ViewSchema, ViewColumn } from "@secondlayer/views/types";
import { ViewRegistryCache } from "../views/cache.ts";
import { getApiKeyId, getAccountId, getAccountKeyIds } from "../lib/ownership.ts";
import { enforceLimits } from "../middleware/enforce-limits.ts";

const app = new Hono();

// Enforce view creation limit
app.post("/", enforceLimits("views"));

// View registry cache — auto-refreshes via PG NOTIFY
const cache = new ViewRegistryCache(async () => {
  const db = getDb();
  return listViews(db);
});

/** Start the cache listener. Call once on API startup. */
export async function startViewCache(): Promise<void> {
  await cache.start();
}

/** Stop the cache listener. Call on API shutdown. */
export async function stopViewCache(): Promise<void> {
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
};

function ident(name: string): string {
  if (!/^[a-z0-9_]+$/i.test(name)) {
    throw new Error(`Invalid identifier: ${name}`);
  }
  return `"${name}"`;
}

/** Get the PG schema name for a view, preferring stored schema_name */
function viewSchemaName(view: View): string {
  return view.schema_name ?? pgSchemaName(view.name);
}

function getValidColumns(table: { columns: Record<string, ViewColumn> }): Set<string> {
  const cols = new Set(Object.keys(table.columns));
  for (const sc of SYSTEM_COLUMNS) cols.add(sc);
  return cols;
}

function getViewSchema(view: View): ViewSchema {
  return (view.definition as any)?.schema ?? {};
}

class InvalidColumnError extends Error {
  constructor(column: string) {
    super(`Unknown column: ${column}`);
  }
}

interface ParsedQuery {
  filters: { column: string; op: string; value: string }[];
  sort?: string;
  order: "ASC" | "DESC";
  limit: number;
  offset: number;
  fields?: string[];
}

function parseQueryParams(
  params: Record<string, string>,
  validColumns: Set<string>,
): ParsedQuery {
  const filters: ParsedQuery["filters"] = [];
  let sort: string | undefined;
  let order: "ASC" | "DESC" = "ASC";
  let limit = DEFAULT_LIMIT;
  let offset = 0;
  let fields: string[] | undefined;

  for (const [key, value] of Object.entries(params)) {
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
        filters.push({ column: col, op: COMPARISON_OPS[op], value });
        continue;
      }
    }

    // Equality filter
    if (!validColumns.has(key)) throw new InvalidColumnError(key);
    filters.push({ column: key, op: "=", value });
  }

  return { filters, sort, order, limit, offset, fields };
}

async function query(text: string, params: unknown[] = []) {
  const client = getRawClient();
  return client.unsafe(text, params as any[]);
}

class ViewNotFoundError extends Error {
  code = "VIEW_NOT_FOUND";
  constructor(viewName: string) {
    super(`View not found: ${viewName}`);
    this.name = "ViewNotFoundError";
  }
}

/** Resolve account key IDs for the current request */
async function resolveKeyIds(c: any): Promise<string[] | undefined> {
  const db = getDb();
  const accountId = getAccountId(c);
  if (!accountId) return undefined;
  return getAccountKeyIds(db, accountId);
}

/** Look up a view from cache with account-level ownership check */
function getOwnedView(viewName: string, keyIds: string[] | undefined): View {
  const view = cache.get(viewName, keyIds);
  if (!view) {
    throw new ViewNotFoundError(viewName);
  }
  return view;
}

// ── Deploy a view ───────────────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR ?? "./data";

app.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = DeployViewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten().fieldErrors }, 400);
  }

  const { name, handlerCode, reindex } = parsed.data;
  const viewsDir = join(DATA_DIR, "views");
  if (!existsSync(viewsDir)) {
    mkdirSync(viewsDir, { recursive: true });
  }

  const handlerPath = join(viewsDir, `${name}.js`);
  await Bun.write(handlerPath, handlerCode);

  // Import the handler to get a full ViewDefinition with handler functions
  let def: any;
  try {
    const mod = await import(`${handlerPath}?t=${Date.now()}`);
    def = mod.default ?? mod;
  } catch (err) {
    return c.json({
      error: `Failed to load handler: ${err instanceof Error ? err.message : String(err)}`,
    }, 400);
  }

  try {
    const { validateViewDefinition } = await import("@secondlayer/views/validate");
    validateViewDefinition(def);
  } catch (err) {
    return c.json({
      error: `Invalid view definition: ${err instanceof Error ? err.message : String(err)}`,
    }, 400);
  }

  const apiKeyId = getApiKeyId(c);
  const apiKey = (c as any).get("apiKey");
  const keyPrefix = apiKey?.key_prefix;

  // Compute tenant-prefixed schema name
  const schemaName = keyPrefix ? pgSchemaName(name, keyPrefix) : pgSchemaName(name);

  const { deploySchema } = await import("@secondlayer/views");
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
    viewId: result.viewId,
    message: `View "${name}" ${result.action}`,
  }, status);
});

// ── Reindex a view ──────────────────────────────────────────────────────

app.post("/:viewName/reindex", async (c) => {
  const { viewName } = c.req.param();
  const keyIds = await resolveKeyIds(c);
  const view = getOwnedView(viewName, keyIds);

  const body = await c.req.json().catch(() => ({}));
  const fromBlock = typeof body.fromBlock === "number" ? body.fromBlock : undefined;
  const toBlock = typeof body.toBlock === "number" ? body.toBlock : undefined;

  // Fire and forget — load handler + reindex runs in background
  (async () => {
    try {
      const { reindexView } = await import("@secondlayer/views");
      const mod = await import(view.handler_path);
      const def = mod.default ?? mod;
      await reindexView(def, { fromBlock, toBlock, schemaName: viewSchemaName(view) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Reindex failed for ${viewName}: ${msg}`);
    }
  })();

  return c.json({
    message: `Reindex started for view "${viewName}"`,
    fromBlock: fromBlock ?? 1,
    toBlock: toBlock ?? "chain tip",
  });
});

// ── Delete a view ────────────────────────────────────────────────────────

app.delete("/:viewName", async (c) => {
  const { viewName } = c.req.param();
  const apiKeyId = getApiKeyId(c);
  const keyIds = await resolveKeyIds(c);
  const view = getOwnedView(viewName, keyIds);

  const db = getDb();
  const sn = viewSchemaName(view);

  // Drop the view's schema (all tables) and remove registry entry
  const client = getRawClient();
  await client.unsafe(`DROP SCHEMA IF EXISTS ${ident(sn)} CASCADE`);
  const { deleteView } = await import("@secondlayer/shared/db/queries/views");
  await deleteView(db, viewName, apiKeyId);

  // Clean up handler file if it exists
  if (view.handler_path) {
    try { unlinkSync(view.handler_path); } catch {}
  }

  // Refresh cache
  await cache.refresh();

  return c.json({ message: `View "${viewName}" deleted` });
});

// ── List all views ──────────────────────────────────────────────────────

app.get("/", async (c) => {
  const keyIds = await resolveKeyIds(c);
  const allViews = cache.getAll(keyIds);

  return c.json({
    data: allViews.map((v) => ({
      name: v.name,
      version: v.version,
      status: v.status,
      lastProcessedBlock: v.last_processed_block,
      tables: Object.keys(getViewSchema(v)),
      createdAt: v.created_at.toISOString(),
    })),
  });
});

// ── View metadata + docs ────────────────────────────────────────────────

app.get("/:viewName", async (c) => {
  const { viewName } = c.req.param();
  const keyIds = await resolveKeyIds(c);
  const view = getOwnedView(viewName, keyIds);

  const viewSchema = getViewSchema(view);
  const tables: Record<string, any> = {};
  const sn = viewSchemaName(view);

  for (const [tableName, tableDef] of Object.entries(viewSchema)) {
    let rowCount = 0;
    try {
      const result = await query(
        `SELECT COUNT(*) as count FROM ${ident(sn)}.${ident(tableName)}`,
      );
      rowCount = parseInt(String(result[0]?.count ?? 0), 10);
    } catch {
      // Table might not exist yet
    }

    const columns: Record<string, string> = {};
    for (const [colName, col] of Object.entries(tableDef.columns)) {
      columns[colName] = col.type;
    }
    columns._id = "serial";
    columns._block_height = "bigint";
    columns._tx_id = "text";
    columns._created_at = "timestamp";

    tables[tableName] = {
      endpoint: `/views/${viewName}/${tableName}`,
      columns,
      rowCount,
      example: `/views/${viewName}/${tableName}?_sort=_block_height&_order=desc&_limit=10`,
    };
  }

  const errorRate = view.total_processed > 0
    ? view.total_errors / view.total_processed
    : 0;

  return c.json({
    name: view.name,
    version: view.version,
    status: view.status,
    lastProcessedBlock: view.last_processed_block,
    health: {
      totalProcessed: view.total_processed,
      totalErrors: view.total_errors,
      errorRate: parseFloat(errorRate.toFixed(4)),
      lastError: view.last_error ?? null,
      lastErrorAt: view.last_error_at?.toISOString() ?? null,
    },
    tables,
    createdAt: view.created_at.toISOString(),
    updatedAt: view.updated_at.toISOString(),
  });
});

// ── Count rows ──────────────────────────────────────────────────────────

app.get("/:viewName/:tableName/count", async (c) => {
  const { viewName, tableName } = c.req.param();
  const keyIds = await resolveKeyIds(c);
  const view = getOwnedView(viewName, keyIds);

  const viewSchema = getViewSchema(view);
  const tableDef = viewSchema[tableName];
  if (!tableDef) {
    return c.json({ error: "Table not found", code: "TABLE_NOT_FOUND" }, 404);
  }

  const validColumns = getValidColumns(tableDef);
  const filterParams = Object.fromEntries(
    Object.entries(c.req.query()).filter(([k]) => !k.startsWith("_")),
  );

  try {
    const parsed = parseQueryParams(filterParams, validColumns);
    const sn = viewSchemaName(view);
    const params: unknown[] = [];
    let text = `SELECT COUNT(*) as count FROM ${ident(sn)}.${ident(tableName)}`;

    if (parsed.filters.length > 0) {
      const conditions = parsed.filters.map((f) => {
        params.push(f.value);
        return `${ident(f.column)} ${f.op} $${params.length}`;
      });
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

app.get("/:viewName/:tableName/:id", async (c) => {
  const { viewName, tableName, id } = c.req.param();
  if (id === "count") return;

  const keyIds = await resolveKeyIds(c);
  const view = getOwnedView(viewName, keyIds);

  const viewSchema = getViewSchema(view);
  if (!viewSchema[tableName]) {
    return c.json({ error: "Table not found", code: "TABLE_NOT_FOUND" }, 404);
  }

  const sn = viewSchemaName(view);
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

app.get("/:viewName/:tableName", async (c) => {
  const { viewName, tableName } = c.req.param();
  const keyIds = await resolveKeyIds(c);
  const view = getOwnedView(viewName, keyIds);

  const viewSchema = getViewSchema(view);
  const tableDef = viewSchema[tableName];
  if (!tableDef) {
    return c.json({ error: "Table not found", code: "TABLE_NOT_FOUND" }, 404);
  }

  const validColumns = getValidColumns(tableDef);

  try {
    const parsed = parseQueryParams(c.req.query(), validColumns);
    const sn = viewSchemaName(view);
    const params: unknown[] = [];

    const selectFields = parsed.fields
      ? parsed.fields.map((f) => ident(f)).join(", ")
      : "*";

    let text = `SELECT ${selectFields} FROM ${ident(sn)}.${ident(tableName)}`;

    if (parsed.filters.length > 0) {
      const conditions = parsed.filters.map((f) => {
        params.push(f.value);
        return `${ident(f.column)} ${f.op} $${params.length}`;
      });
      text += ` WHERE ${conditions.join(" AND ")}`;
    }

    const sortCol = parsed.sort ? ident(parsed.sort) : '"_id"';
    text += ` ORDER BY ${sortCol} ${parsed.order}`;
    text += ` LIMIT ${parsed.limit} OFFSET ${parsed.offset}`;

    let countText = `SELECT COUNT(*) as count FROM ${ident(sn)}.${ident(tableName)}`;
    if (parsed.filters.length > 0) {
      const conditions = parsed.filters.map((f, i) => {
        return `${ident(f.column)} ${f.op} $${i + 1}`;
      });
      countText += ` WHERE ${conditions.join(" AND ")}`;
    }

    const [data, countResult] = await Promise.all([
      query(text, params),
      query(countText, params),
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
