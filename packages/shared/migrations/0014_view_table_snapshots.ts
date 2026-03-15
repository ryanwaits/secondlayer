import type { Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("view_table_snapshots")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(db.fn("gen_random_uuid")),
    )
    .addColumn("view_name", "text", (col) => col.notNull())
    .addColumn("api_key_id", "text")
    .addColumn("table_name", "text", (col) => col.notNull())
    .addColumn("row_count", "bigint")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(db.fn("now")),
    )
    .execute();

  await db.schema
    .createIndex("idx_view_table_snapshots_view_table_created")
    .on("view_table_snapshots")
    .columns(["view_name", "table_name", "created_at"])
    .execute();

  await db.schema
    .createIndex("idx_view_table_snapshots_api_key")
    .on("view_table_snapshots")
    .column("api_key_id")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("view_table_snapshots").execute();
}
