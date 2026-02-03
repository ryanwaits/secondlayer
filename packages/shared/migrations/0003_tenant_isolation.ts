import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Drop PG schemas for views with null api_key_id (orphaned pre-product data)
  const orphanedViews = await db
    .selectFrom("views")
    .select("name")
    .where("api_key_id", "is", null)
    .execute();

  for (const view of orphanedViews) {
    const schemaName = `view_${view.name.replace(/-/g, "_")}`;
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
  }

  // 2. Delete orphaned rows (null api_key_id)
  await db.deleteFrom("views").where("api_key_id", "is", null).execute();

  // Delete stream_metrics for orphaned streams first (FK)
  const orphanedStreamIds = await db
    .selectFrom("streams")
    .select("id")
    .where("api_key_id", "is", null)
    .execute();

  if (orphanedStreamIds.length > 0) {
    await db
      .deleteFrom("stream_metrics")
      .where(
        "stream_id",
        "in",
        orphanedStreamIds.map((s) => s.id),
      )
      .execute();

    // Delete jobs + deliveries for orphaned streams
    await db
      .deleteFrom("deliveries")
      .where(
        "stream_id",
        "in",
        orphanedStreamIds.map((s) => s.id),
      )
      .execute();

    await db
      .deleteFrom("jobs")
      .where(
        "stream_id",
        "in",
        orphanedStreamIds.map((s) => s.id),
      )
      .execute();
  }

  await db.deleteFrom("streams").where("api_key_id", "is", null).execute();

  // 3. Add schema_name column to views
  await db.schema
    .alterTable("views")
    .addColumn("schema_name", "text")
    .execute();

  // Backfill schema_name for existing views
  const existingViews = await db
    .selectFrom("views")
    .select(["id", "name"])
    .execute();

  for (const view of existingViews) {
    const schemaName = `view_${view.name.replace(/-/g, "_")}`;
    await db
      .updateTable("views")
      .set({ schema_name: schemaName })
      .where("id", "=", view.id)
      .execute();
  }

  // 4. Drop unique constraint on views(name), replace with views(name, api_key_id)
  // The original unique constraint is from the initial migration on "name"
  await sql.raw(`ALTER TABLE views DROP CONSTRAINT IF EXISTS views_name_key`).execute(db);
  await sql.raw(`ALTER TABLE views DROP CONSTRAINT IF EXISTS views_name_unique`).execute(db);

  await db.schema
    .createIndex("views_name_api_key_id_unique")
    .on("views")
    .columns(["name", "api_key_id"])
    .unique()
    .execute();

  // 5. Add indexes for tenant scoping
  await db.schema
    .createIndex("streams_api_key_id_idx")
    .on("streams")
    .column("api_key_id")
    .execute();

  await db.schema
    .createIndex("views_api_key_id_idx")
    .on("views")
    .column("api_key_id")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex("views_api_key_id_idx").ifExists().execute();
  await db.schema.dropIndex("streams_api_key_id_idx").ifExists().execute();
  await db.schema.dropIndex("views_name_api_key_id_unique").ifExists().execute();

  // Restore original unique constraint on name
  await sql.raw(`ALTER TABLE views ADD CONSTRAINT views_name_key UNIQUE (name)`).execute(db);

  await db.schema.alterTable("views").dropColumn("schema_name").execute();
}
