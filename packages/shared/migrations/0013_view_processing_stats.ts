import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("view_processing_stats")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(db.fn("gen_random_uuid")),
    )
    .addColumn("view_name", "text", (col) => col.notNull())
    .addColumn("api_key_id", "text")
    .addColumn("bucket_start", "timestamptz")
    .addColumn("bucket_end", "timestamptz")
    .addColumn("blocks_processed", "integer")
    .addColumn("total_time_ms", "integer")
    .addColumn("handler_time_ms", "integer")
    .addColumn("flush_time_ms", "integer")
    .addColumn("max_block_time_ms", "integer")
    .addColumn("max_handler_time_ms", "integer")
    .addColumn("avg_ops_per_block", sql`real`)
    .addColumn("is_catchup", "boolean", (col) => col.defaultTo(false))
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(db.fn("now")),
    )
    .execute();

  await db.schema
    .createIndex("idx_view_processing_stats_view_bucket")
    .on("view_processing_stats")
    .columns(["view_name", "bucket_start"])
    .execute();

  await db.schema
    .createIndex("idx_view_processing_stats_api_key")
    .on("view_processing_stats")
    .column("api_key_id")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("view_processing_stats").execute();
}
