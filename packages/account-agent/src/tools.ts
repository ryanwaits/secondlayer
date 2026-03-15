import type { Kysely } from "kysely";
import type { Database } from "@secondlayer/shared/db";
import { sql } from "@secondlayer/shared/db";
import type Anthropic from "@anthropic-ai/sdk";

// ── Tool definitions for Claude ──────────────────────────────────────

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "get_stream_health",
    description:
      "Get all streams for this account with their current metrics (delivery counts, error rates, last triggered time).",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_recent_deliveries",
    description:
      "Get the last 50 deliveries per stream, including status_code and response_time_ms. Use to detect failure patterns and response time trends.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_delivery_stats",
    description:
      "Get aggregated delivery stats (avg response time, p95, timeout rate) over 1h, 24h, and 7d windows per stream.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_key_usage",
    description:
      "Get all API keys for this account with name, last_used_at, ip_address, and status.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_usage_trend",
    description:
      "Get daily usage (api_requests, deliveries) for the last 30 days.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_view_health",
    description:
      "Get all views with health metrics and historical snapshots (last 48h) for trend analysis. Also returns chain indexing progress.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_view_performance",
    description:
      "Get view processing performance stats (avg/max block time, handler time, flush time) over 1h, 24h, and 7d windows per view.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_view_table_growth",
    description:
      "Get view table row counts with 24h and 7d growth rates. Takes a snapshot on each call for trend tracking.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_view_schema_health",
    description:
      "Compare view definitions against actual PG schema. Detects missing columns, type mismatches, high NULL rates, and missing indexes.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
];

// ── Tool implementations ─────────────────────────────────────────────

export async function executeTool(
  toolName: string,
  accountId: string,
  db: Kysely<Database>,
): Promise<unknown> {
  switch (toolName) {
    case "get_stream_health":
      return getStreamHealth(accountId, db);
    case "get_recent_deliveries":
      return getRecentDeliveries(accountId, db);
    case "get_delivery_stats":
      return getDeliveryStats(accountId, db);
    case "get_key_usage":
      return getKeyUsage(accountId, db);
    case "get_usage_trend":
      return getUsageTrend(accountId, db);
    case "get_view_health":
      return getViewHealth(accountId, db);
    case "get_view_performance":
      return getViewPerformance(accountId, db);
    case "get_view_table_growth":
      return getViewTableGrowth(accountId, db);
    case "get_view_schema_health":
      return getViewSchemaHealth(accountId, db);
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

async function getAccountKeyIds(
  accountId: string,
  db: Kysely<Database>,
): Promise<string[]> {
  const keys = await db
    .selectFrom("api_keys")
    .select("id")
    .where("account_id", "=", accountId)
    .where("status", "=", "active")
    .execute();
  return keys.map((k) => k.id);
}

async function getStreamHealth(accountId: string, db: Kysely<Database>) {
  const keyIds = await getAccountKeyIds(accountId, db);
  if (keyIds.length === 0) return [];

  return db
    .selectFrom("streams")
    .leftJoin("stream_metrics", "streams.id", "stream_metrics.stream_id")
    .select([
      "streams.id",
      "streams.name",
      "streams.status",
      "streams.created_at",
      "stream_metrics.total_deliveries",
      "stream_metrics.failed_deliveries",
      "stream_metrics.last_triggered_at",
      "stream_metrics.last_triggered_block",
      "stream_metrics.error_message",
    ])
    .where("streams.api_key_id", "in", keyIds)
    .execute();
}

async function getRecentDeliveries(accountId: string, db: Kysely<Database>) {
  const keyIds = await getAccountKeyIds(accountId, db);
  if (keyIds.length === 0) return [];

  const streamIds = await db
    .selectFrom("streams")
    .select("id")
    .where("api_key_id", "in", keyIds)
    .execute();

  if (streamIds.length === 0) return [];

  return db
    .selectFrom("deliveries")
    .select([
      "id",
      "stream_id",
      "block_height",
      "status",
      "status_code",
      "response_time_ms",
      "error",
      "created_at",
    ])
    .where(
      "stream_id",
      "in",
      streamIds.map((s) => s.id),
    )
    .orderBy("created_at", "desc")
    .limit(250) // 50 per stream, up to 5 streams
    .execute();
}

async function getDeliveryStats(accountId: string, db: Kysely<Database>) {
  const keyIds = await getAccountKeyIds(accountId, db);
  if (keyIds.length === 0) return [];

  const streamIds = await db
    .selectFrom("streams")
    .select("id")
    .where("api_key_id", "in", keyIds)
    .execute();

  if (streamIds.length === 0) return [];

  const ids = streamIds.map((s) => s.id);

  // Get stats for each time window
  const windows = [
    { label: "1h", interval: "1 hour" },
    { label: "24h", interval: "24 hours" },
    { label: "7d", interval: "7 days" },
  ];

  const results = [];
  for (const w of windows) {
    const stats = await sql<{
      stream_id: string;
      avg_ms: number;
      p95_ms: number;
      total: number;
      timeouts: number;
    }>`
      SELECT
        stream_id,
        COALESCE(AVG(response_time_ms), 0)::int AS avg_ms,
        COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms), 0)::int AS p95_ms,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'timeout')::int AS timeouts
      FROM deliveries
      WHERE stream_id = ANY(${ids})
        AND created_at > NOW() - ${sql.raw(`INTERVAL '${w.interval}'`)}
      GROUP BY stream_id
    `.execute(db);

    for (const row of stats.rows) {
      results.push({ ...row, window: w.label });
    }
  }

  return results;
}

async function getKeyUsage(accountId: string, db: Kysely<Database>) {
  return db
    .selectFrom("api_keys")
    .select(["id", "key_prefix", "name", "status", "ip_address", "last_used_at", "created_at"])
    .where("account_id", "=", accountId)
    .execute();
}

async function getUsageTrend(accountId: string, db: Kysely<Database>) {
  return db
    .selectFrom("usage_daily")
    .select(["date", "api_requests", "deliveries"])
    .where("account_id", "=", accountId)
    .orderBy("date", "desc")
    .limit(30)
    .execute();
}

async function getViewHealth(accountId: string, db: Kysely<Database>) {
  const keyIds = await getAccountKeyIds(accountId, db);
  if (keyIds.length === 0) return { views: [], chain: null };

  // Get all views for this account
  const views = await db
    .selectFrom("views")
    .selectAll()
    .where("api_key_id", "in", keyIds)
    .execute();

  if (views.length === 0) return { views: [], chain: null };

  const viewIds = views.map((v) => v.id);
  const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000);

  // Get snapshots from last 48h
  const snapshots = await db
    .selectFrom("view_health_snapshots")
    .select(["view_id", "total_processed", "total_errors", "last_processed_block", "captured_at"])
    .where("view_id", "in", viewIds)
    .where("captured_at", ">", cutoff48h)
    .orderBy("captured_at", "asc")
    .execute();

  // Upsert a snapshot per view (skip if one exists within last 25 min)
  const cutoff25m = new Date(Date.now() - 25 * 60 * 1000);
  for (const view of views) {
    const recentSnapshot = snapshots.find(
      (s) => s.view_id === view.id && s.captured_at > cutoff25m,
    );
    if (!recentSnapshot) {
      await db
        .insertInto("view_health_snapshots")
        .values({
          view_id: view.id,
          total_processed: view.total_processed,
          total_errors: view.total_errors,
          last_processed_block: view.last_processed_block,
        })
        .execute();
    }
  }

  // Prune snapshots older than 7 days
  const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await db
    .deleteFrom("view_health_snapshots")
    .where("captured_at", "<", cutoff7d)
    .execute();

  // Get chain status
  let chain = null;
  try {
    const progress = await db
      .selectFrom("index_progress")
      .selectAll()
      .executeTakeFirst();
    if (progress) {
      chain = {
        last_contiguous_block: progress.last_contiguous_block,
        highest_seen_block: progress.highest_seen_block,
        updated_at: progress.updated_at.toISOString(),
      };
    }
  } catch {}

  // Build response with snapshots grouped by view
  const snapshotsByView = new Map<string, typeof snapshots>();
  for (const s of snapshots) {
    const arr = snapshotsByView.get(s.view_id) ?? [];
    arr.push(s);
    snapshotsByView.set(s.view_id, arr);
  }

  return {
    views: views.map((v) => ({
      id: v.id,
      name: v.name,
      status: v.status,
      last_processed_block: v.last_processed_block,
      total_processed: v.total_processed,
      total_errors: v.total_errors,
      error_rate: v.total_processed > 0
        ? parseFloat((v.total_errors / v.total_processed).toFixed(4))
        : 0,
      last_error: v.last_error,
      last_error_at: v.last_error_at?.toISOString() ?? null,
      created_at: v.created_at.toISOString(),
      updated_at: v.updated_at.toISOString(),
      snapshots: (snapshotsByView.get(v.id) ?? []).map((s) => ({
        total_processed: s.total_processed,
        total_errors: s.total_errors,
        last_processed_block: s.last_processed_block,
        captured_at: s.captured_at.toISOString(),
      })),
    })),
    chain,
  };
}

// ── V5 — View Performance Stats ─────────────────────────────────────

async function getViewPerformance(accountId: string, db: Kysely<Database>) {
  const keyIds = await getAccountKeyIds(accountId, db);
  if (keyIds.length === 0) return [];

  const views = await db
    .selectFrom("views")
    .select(["name", "api_key_id"])
    .where("api_key_id", "in", keyIds)
    .execute();

  if (views.length === 0) return [];

  const viewNames = views.map((v) => v.name);
  const windows = [
    { label: "1h", ms: 60 * 60 * 1000 },
    { label: "24h", ms: 24 * 60 * 60 * 1000 },
    { label: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
  ];

  const results = [];
  for (const w of windows) {
    const cutoff = new Date(Date.now() - w.ms);
    const stats = await db
      .selectFrom("view_processing_stats")
      .select([
        "view_name",
        (eb) => eb.fn.sum<number>("blocks_processed").as("total_blocks"),
        (eb) => eb.fn.sum<number>("total_time_ms").as("total_time"),
        (eb) => eb.fn.sum<number>("handler_time_ms").as("total_handler_time"),
        (eb) => eb.fn.sum<number>("flush_time_ms").as("total_flush_time"),
        (eb) => eb.fn.max<number>("max_block_time_ms").as("max_block_time"),
        (eb) => eb.fn.max<number>("max_handler_time_ms").as("max_handler_time"),
      ])
      .where("view_name", "in", viewNames)
      .where("bucket_start", ">", cutoff)
      .groupBy("view_name")
      .execute();

    for (const row of stats) {
      const blocks = Number(row.total_blocks) || 1;
      results.push({
        view_name: row.view_name,
        window: w.label,
        blocks_processed: Number(row.total_blocks),
        avg_block_time_ms: Math.round(Number(row.total_time) / blocks),
        avg_handler_time_ms: Math.round(Number(row.total_handler_time) / blocks),
        avg_flush_time_ms: Math.round(Number(row.total_flush_time) / blocks),
        max_block_time_ms: Number(row.max_block_time),
        max_handler_time_ms: Number(row.max_handler_time),
      });
    }
  }

  return results;
}

// ── V6 — View Table Growth ──────────────────────────────────────────

async function getViewTableGrowth(accountId: string, db: Kysely<Database>) {
  const keyIds = await getAccountKeyIds(accountId, db);
  if (keyIds.length === 0) return [];

  const views = await db
    .selectFrom("views")
    .selectAll()
    .where("api_key_id", "in", keyIds)
    .execute();

  if (views.length === 0) return [];

  const results = [];

  for (const view of views) {
    const schema = (view.definition as any)?.schema ?? {};
    const tableNames = Object.keys(schema);
    const schemaName = view.schema_name ?? view.name.replace(/[^a-z0-9_]/gi, "_");

    for (const tableName of tableNames) {
      // Get approximate row count from pg_stat
      let rowCount = 0;
      try {
        const countResult = await sql<{ n_live_tup: number }>`
          SELECT n_live_tup FROM pg_stat_user_tables
          WHERE schemaname = ${schemaName} AND relname = ${tableName}
        `.execute(db);
        rowCount = Number(countResult.rows[0]?.n_live_tup) || 0;
      } catch {}

      // Snapshot current count
      await db
        .insertInto("view_table_snapshots")
        .values({
          view_name: view.name,
          api_key_id: view.api_key_id,
          table_name: tableName,
          row_count: rowCount,
        })
        .execute();

      // Get historical snapshots for growth calculation
      const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const oldest24h = await db
        .selectFrom("view_table_snapshots")
        .select("row_count")
        .where("view_name", "=", view.name)
        .where("table_name", "=", tableName)
        .where("created_at", ">", cutoff24h)
        .orderBy("created_at", "asc")
        .limit(1)
        .executeTakeFirst();

      const oldest7d = await db
        .selectFrom("view_table_snapshots")
        .select("row_count")
        .where("view_name", "=", view.name)
        .where("table_name", "=", tableName)
        .where("created_at", ">", cutoff7d)
        .orderBy("created_at", "asc")
        .limit(1)
        .executeTakeFirst();

      results.push({
        view_name: view.name,
        table_name: tableName,
        current_rows: rowCount,
        growth_24h: oldest24h ? rowCount - Number(oldest24h.row_count) : null,
        growth_7d: oldest7d ? rowCount - Number(oldest7d.row_count) : null,
        daily_avg_7d: oldest7d
          ? Math.round((rowCount - Number(oldest7d.row_count)) / 7)
          : null,
      });
    }
  }

  // Prune snapshots older than 30 days
  const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await db
    .deleteFrom("view_table_snapshots")
    .where("created_at", "<", cutoff30d)
    .execute();

  return results;
}

// ── V7 — View Schema Health ─────────────────────────────────────────

async function getViewSchemaHealth(accountId: string, db: Kysely<Database>) {
  const keyIds = await getAccountKeyIds(accountId, db);
  if (keyIds.length === 0) return [];

  const views = await db
    .selectFrom("views")
    .selectAll()
    .where("api_key_id", "in", keyIds)
    .execute();

  if (views.length === 0) return [];

  const issues = [];

  for (const view of views) {
    const defSchema = (view.definition as any)?.schema ?? {};
    const schemaName = view.schema_name ?? view.name.replace(/[^a-z0-9_]/gi, "_");

    for (const [tableName, tableDef] of Object.entries(defSchema) as [string, any][]) {
      // Get actual PG columns
      const pgCols = await sql<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = ${schemaName} AND table_name = ${tableName}
      `.execute(db);

      if (pgCols.rows.length === 0) {
        issues.push({
          view_name: view.name,
          type: "empty_table",
          table: tableName,
          detail: "Table does not exist in database",
          severity: "warning",
        });
        continue;
      }

      const pgColMap = new Map(pgCols.rows.map((c) => [c.column_name, c]));
      const defColumns = tableDef.columns ?? {};

      // Check for missing columns (in definition but not in PG)
      for (const colName of Object.keys(defColumns)) {
        if (!pgColMap.has(colName)) {
          issues.push({
            view_name: view.name,
            type: "missing_column",
            table: tableName,
            column: colName,
            detail: `Column "${colName}" defined in schema but missing from database`,
            severity: "warning",
          });
        }
      }

      // Check NULL rates by sampling recent 10k rows
      try {
        const userCols = Object.keys(defColumns);
        if (userCols.length > 0) {
          // Build a query to check NULL rates for all user columns
          const nullChecks = userCols.map(
            (col) => `COUNT(*) FILTER (WHERE "${col}" IS NULL)::float / GREATEST(COUNT(*), 1) AS "null_${col}"`,
          ).join(", ");

          const nullResult = await sql.raw(
            `SELECT COUNT(*) as total, ${nullChecks}
             FROM (SELECT * FROM "${schemaName}"."${tableName}" ORDER BY "_id" DESC LIMIT 10000) sub`,
          ).execute(db);

          const row = (nullResult.rows as Record<string, unknown>[])[0];
          const total = Number(row?.total) || 0;

          if (total >= 100) {
            for (const col of userCols) {
              const nullRate = Number(row?.[`null_${col}`]) || 0;
              if (nullRate > 0.95) {
                issues.push({
                  view_name: view.name,
                  type: "null_column",
                  table: tableName,
                  column: col,
                  detail: `Column "${col}" is ${(nullRate * 100).toFixed(1)}% NULL across ${total.toLocaleString()} sampled rows`,
                  severity: "info",
                });
              }
            }
          }
        }
      } catch {}

      // Check for missing indexes declared in definition
      if (tableDef.indexes) {
        const pgIndexes = await sql<{ indexdef: string }>`
          SELECT indexdef FROM pg_indexes
          WHERE schemaname = ${schemaName} AND tablename = ${tableName}
        `.execute(db);

        const indexDefs = pgIndexes.rows.map((r) => r.indexdef.toLowerCase());

        for (const idx of tableDef.indexes as string[][]) {
          const colsInIdx = idx.map((c: string) => `"${c}"`).join(", ");
          const found = indexDefs.some((def) =>
            idx.every((col: string) => def.includes(`"${col}"`)),
          );
          if (!found) {
            issues.push({
              view_name: view.name,
              type: "missing_index",
              table: tableName,
              detail: `Composite index on (${colsInIdx}) declared but not found in database`,
              severity: "info",
            });
          }
        }
      }
    }
  }

  return issues;
}
