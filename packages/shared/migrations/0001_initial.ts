import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  // ── blocks ──────────────────────────────────────────────────────────
  await db.schema
    .createTable("blocks")
    .addColumn("height", "bigint", (c) => c.primaryKey())
    .addColumn("hash", "text", (c) => c.notNull())
    .addColumn("parent_hash", "text", (c) => c.notNull())
    .addColumn("burn_block_height", "bigint", (c) => c.notNull())
    .addColumn("timestamp", "bigint", (c) => c.notNull())
    .addColumn("canonical", "boolean", (c) => c.notNull().defaultTo(true))
    .addColumn("created_at", "timestamp", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createIndex("blocks_hash_idx").on("blocks").column("hash").execute();
  await db.schema.createIndex("blocks_canonical_height_idx").on("blocks").columns(["canonical", "height"]).execute();

  // ── transactions ────────────────────────────────────────────────────
  await db.schema
    .createTable("transactions")
    .addColumn("tx_id", "text", (c) => c.primaryKey())
    .addColumn("block_height", "bigint", (c) => c.notNull().references("blocks.height"))
    .addColumn("type", "text", (c) => c.notNull())
    .addColumn("sender", "text", (c) => c.notNull())
    .addColumn("status", "text", (c) => c.notNull())
    .addColumn("contract_id", "text")
    .addColumn("function_name", "text")
    .addColumn("raw_tx", "text", (c) => c.notNull())
    .addColumn("created_at", "timestamp", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createIndex("transactions_block_height_idx").on("transactions").column("block_height").execute();
  await db.schema.createIndex("transactions_sender_idx").on("transactions").column("sender").execute();
  await db.schema.createIndex("transactions_contract_id_idx").on("transactions").column("contract_id").execute();

  // ── events ──────────────────────────────────────────────────────────
  await db.schema
    .createTable("events")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("tx_id", "text", (c) => c.notNull().references("transactions.tx_id"))
    .addColumn("block_height", "bigint", (c) => c.notNull().references("blocks.height"))
    .addColumn("event_index", "integer", (c) => c.notNull())
    .addColumn("type", "text", (c) => c.notNull())
    .addColumn("data", "jsonb", (c) => c.notNull())
    .addColumn("created_at", "timestamp", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createIndex("events_tx_id_idx").on("events").column("tx_id").execute();
  await db.schema.createIndex("events_block_height_idx").on("events").column("block_height").execute();
  await db.schema.createIndex("events_type_idx").on("events").column("type").execute();

  // ── streams ─────────────────────────────────────────────────────────
  await db.schema
    .createTable("streams")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("status", "text", (c) => c.notNull().defaultTo("active"))
    .addColumn("filters", "jsonb", (c) => c.notNull())
    .addColumn("options", "jsonb", (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn("webhook_url", "text", (c) => c.notNull())
    .addColumn("webhook_secret", "text")
    .addColumn("created_at", "timestamp", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamp", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createIndex("streams_status_idx").on("streams").column("status").execute();

  // ── stream_metrics ──────────────────────────────────────────────────
  await db.schema
    .createTable("stream_metrics")
    .addColumn("stream_id", "uuid", (c) => c.primaryKey().references("streams.id").onDelete("cascade"))
    .addColumn("last_triggered_at", "timestamp")
    .addColumn("last_triggered_block", "bigint")
    .addColumn("total_deliveries", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("failed_deliveries", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("error_message", "text")
    .execute();

  await db.schema.createIndex("stream_metrics_last_triggered_at_idx").on("stream_metrics").column("last_triggered_at").execute();

  // ── jobs ────────────────────────────────────────────────────────────
  await db.schema
    .createTable("jobs")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("stream_id", "uuid", (c) => c.notNull().references("streams.id").onDelete("cascade"))
    .addColumn("block_height", "bigint", (c) => c.notNull())
    .addColumn("status", "text", (c) => c.notNull().defaultTo("pending"))
    .addColumn("attempts", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("locked_at", "timestamp")
    .addColumn("locked_by", "text")
    .addColumn("error", "text")
    .addColumn("backfill", "boolean", (c) => c.notNull().defaultTo(false))
    .addColumn("created_at", "timestamp", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("completed_at", "timestamp")
    .execute();

  await db.schema.createIndex("jobs_stream_id_idx").on("jobs").column("stream_id").execute();
  await db.schema.createIndex("jobs_status_idx").on("jobs").column("status").execute();
  await db.schema.createIndex("jobs_block_height_idx").on("jobs").column("block_height").execute();
  await db.schema.createIndex("jobs_locked_at_idx").on("jobs").column("locked_at").execute();

  // ── index_progress ──────────────────────────────────────────────────
  await db.schema
    .createTable("index_progress")
    .addColumn("network", "text", (c) => c.primaryKey())
    .addColumn("last_indexed_block", "bigint", (c) => c.notNull().defaultTo(0))
    .addColumn("last_contiguous_block", "bigint", (c) => c.notNull().defaultTo(0))
    .addColumn("highest_seen_block", "bigint", (c) => c.notNull().defaultTo(0))
    .addColumn("updated_at", "timestamp", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  // ── deliveries ──────────────────────────────────────────────────────
  await db.schema
    .createTable("deliveries")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("stream_id", "uuid", (c) => c.notNull().references("streams.id").onDelete("cascade"))
    .addColumn("job_id", "uuid", (c) => c.references("jobs.id").onDelete("set null"))
    .addColumn("block_height", "bigint", (c) => c.notNull())
    .addColumn("status", "text", (c) => c.notNull())
    .addColumn("status_code", "integer")
    .addColumn("response_time_ms", "integer")
    .addColumn("attempts", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("error", "text")
    .addColumn("payload", "jsonb", (c) => c.notNull())
    .addColumn("created_at", "timestamp", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createIndex("deliveries_stream_id_idx").on("deliveries").column("stream_id").execute();
  await db.schema.createIndex("deliveries_status_idx").on("deliveries").column("status").execute();
  await db.schema.createIndex("deliveries_block_height_idx").on("deliveries").column("block_height").execute();

  // ── views ───────────────────────────────────────────────────────────
  await db.schema
    .createTable("views")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("name", "text", (c) => c.notNull().unique())
    .addColumn("version", "text", (c) => c.notNull().defaultTo("1.0.0"))
    .addColumn("status", "text", (c) => c.notNull().defaultTo("active"))
    .addColumn("definition", "jsonb", (c) => c.notNull())
    .addColumn("schema_hash", "text", (c) => c.notNull())
    .addColumn("handler_path", "text", (c) => c.notNull())
    .addColumn("last_processed_block", "bigint", (c) => c.notNull().defaultTo(0))
    .addColumn("last_error", "text")
    .addColumn("last_error_at", "timestamp")
    .addColumn("total_processed", "bigint", (c) => c.notNull().defaultTo(0))
    .addColumn("total_errors", "bigint", (c) => c.notNull().defaultTo(0))
    .addColumn("created_at", "timestamp", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamp", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createIndex("views_name_idx").on("views").column("name").execute();
  await db.schema.createIndex("views_status_idx").on("views").column("status").execute();

  // Notify trigger for view changes (used by API hot-reload)
  await sql`
    CREATE OR REPLACE FUNCTION notify_view_changes() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_notify('view_changes', json_build_object(
        'operation', TG_OP,
        'name', COALESCE(NEW.name, OLD.name)
      )::text);
      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

  await sql`
    CREATE TRIGGER views_notify_trigger
      AFTER INSERT OR UPDATE OR DELETE ON "views"
      FOR EACH ROW EXECUTE FUNCTION notify_view_changes()
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS views_notify_trigger ON "views"`.execute(db);
  await sql`DROP FUNCTION IF EXISTS notify_view_changes()`.execute(db);

  for (const table of ["views", "deliveries", "index_progress", "jobs", "stream_metrics", "streams", "events", "transactions", "blocks"]) {
    await db.schema.dropTable(table).ifExists().cascade().execute();
  }
}
