import type { Kysely } from "kysely";
import { sql } from "kysely";

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function up(db: Kysely<any>): Promise<void> {
	// Drop old trigger + function
	await sql`DROP TRIGGER IF EXISTS views_notify_trigger ON "views"`.execute(db);
	await sql`DROP FUNCTION IF EXISTS notify_view_changes()`.execute(db);

	// Rename tables
	await sql`ALTER TABLE "views" RENAME TO "subgraphs"`.execute(db);
	await sql`ALTER TABLE "view_health_snapshots" RENAME TO "subgraph_health_snapshots"`.execute(
		db,
	);
	await sql`ALTER TABLE "view_processing_stats" RENAME TO "subgraph_processing_stats"`.execute(
		db,
	);
	await sql`ALTER TABLE "view_table_snapshots" RENAME TO "subgraph_table_snapshots"`.execute(
		db,
	);

	// Rename indexes on subgraphs (formerly views)
	await sql`ALTER INDEX "views_name_idx" RENAME TO "subgraphs_name_idx"`.execute(
		db,
	);
	await sql`ALTER INDEX "views_status_idx" RENAME TO "subgraphs_status_idx"`.execute(
		db,
	);

	// Rename indexes on subgraph_health_snapshots
	await sql`ALTER INDEX "idx_view_health_snapshots_view_captured" RENAME TO "idx_subgraph_health_snapshots_subgraph_captured"`.execute(
		db,
	);

	// Rename indexes on subgraph_processing_stats
	await sql`ALTER INDEX "idx_view_processing_stats_view_bucket" RENAME TO "idx_subgraph_processing_stats_subgraph_bucket"`.execute(
		db,
	);
	await sql`ALTER INDEX "idx_view_processing_stats_api_key" RENAME TO "idx_subgraph_processing_stats_api_key"`.execute(
		db,
	);

	// Rename indexes on subgraph_table_snapshots
	await sql`ALTER INDEX "idx_view_table_snapshots_view_table_created" RENAME TO "idx_subgraph_table_snapshots_subgraph_table_created"`.execute(
		db,
	);
	await sql`ALTER INDEX "idx_view_table_snapshots_api_key" RENAME TO "idx_subgraph_table_snapshots_api_key"`.execute(
		db,
	);

	// Rename column view_id → subgraph_id in health snapshots
	await sql`ALTER TABLE "subgraph_health_snapshots" RENAME COLUMN "view_id" TO "subgraph_id"`.execute(
		db,
	);

	// Rename column view_name → subgraph_name in processing stats and table snapshots
	await sql`ALTER TABLE "subgraph_processing_stats" RENAME COLUMN "view_name" TO "subgraph_name"`.execute(
		db,
	);
	await sql`ALTER TABLE "subgraph_table_snapshots" RENAME COLUMN "view_name" TO "subgraph_name"`.execute(
		db,
	);

	// Rename FK constraint (Postgres auto-names it based on original table/column)
	await sql`ALTER TABLE "subgraph_health_snapshots" RENAME CONSTRAINT "view_health_snapshots_view_id_fkey" TO "subgraph_health_snapshots_subgraph_id_fkey"`.execute(
		db,
	);

	// Recreate notify trigger with new names
	await sql`
    CREATE OR REPLACE FUNCTION notify_subgraph_changes() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_notify('subgraph_changes', json_build_object(
        'operation', TG_OP,
        'name', COALESCE(NEW.name, OLD.name)
      )::text);
      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

	await sql`
    CREATE TRIGGER subgraphs_notify_trigger
      AFTER INSERT OR UPDATE OR DELETE ON "subgraphs"
      FOR EACH ROW EXECUTE FUNCTION notify_subgraph_changes()
  `.execute(db);

	// Rename any existing tenant schemas from view_* to subgraph_*
	await sql`
    DO $$
    DECLARE
      s record;
    BEGIN
      FOR s IN SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'view_%'
      LOOP
        EXECUTE format('ALTER SCHEMA %I RENAME TO %I', s.schema_name, 'subgraph_' || substring(s.schema_name from 6));
      END LOOP;
    END $$
  `.execute(db);

	// Update schema_name column in subgraphs table to match new prefix
	await sql`UPDATE "subgraphs" SET schema_name = 'subgraph_' || substring(schema_name from 6) WHERE schema_name LIKE 'view_%'`.execute(
		db,
	);
}

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function down(db: Kysely<any>): Promise<void> {
	// Drop new trigger + function
	await sql`DROP TRIGGER IF EXISTS subgraphs_notify_trigger ON "subgraphs"`.execute(
		db,
	);
	await sql`DROP FUNCTION IF EXISTS notify_subgraph_changes()`.execute(db);

	// Revert schema_name column
	await sql`UPDATE "subgraphs" SET schema_name = 'view_' || substring(schema_name from 10) WHERE schema_name LIKE 'subgraph_%'`.execute(
		db,
	);

	// Revert tenant schemas
	await sql`
    DO $$
    DECLARE
      s record;
    BEGIN
      FOR s IN SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'subgraph_%'
      LOOP
        EXECUTE format('ALTER SCHEMA %I RENAME TO %I', s.schema_name, 'view_' || substring(s.schema_name from 10));
      END LOOP;
    END $$
  `.execute(db);

	// Rename columns back
	await sql`ALTER TABLE "subgraph_health_snapshots" RENAME CONSTRAINT "subgraph_health_snapshots_subgraph_id_fkey" TO "view_health_snapshots_view_id_fkey"`.execute(
		db,
	);
	await sql`ALTER TABLE "subgraph_table_snapshots" RENAME COLUMN "subgraph_name" TO "view_name"`.execute(
		db,
	);
	await sql`ALTER TABLE "subgraph_processing_stats" RENAME COLUMN "subgraph_name" TO "view_name"`.execute(
		db,
	);
	await sql`ALTER TABLE "subgraph_health_snapshots" RENAME COLUMN "subgraph_id" TO "view_id"`.execute(
		db,
	);

	// Rename indexes back
	await sql`ALTER INDEX "idx_subgraph_table_snapshots_api_key" RENAME TO "idx_view_table_snapshots_api_key"`.execute(
		db,
	);
	await sql`ALTER INDEX "idx_subgraph_table_snapshots_subgraph_table_created" RENAME TO "idx_view_table_snapshots_view_table_created"`.execute(
		db,
	);
	await sql`ALTER INDEX "idx_subgraph_processing_stats_api_key" RENAME TO "idx_view_processing_stats_api_key"`.execute(
		db,
	);
	await sql`ALTER INDEX "idx_subgraph_processing_stats_subgraph_bucket" RENAME TO "idx_view_processing_stats_view_bucket"`.execute(
		db,
	);
	await sql`ALTER INDEX "idx_subgraph_health_snapshots_subgraph_captured" RENAME TO "idx_view_health_snapshots_view_captured"`.execute(
		db,
	);
	await sql`ALTER INDEX "subgraphs_status_idx" RENAME TO "views_status_idx"`.execute(
		db,
	);
	await sql`ALTER INDEX "subgraphs_name_idx" RENAME TO "views_name_idx"`.execute(
		db,
	);

	// Rename tables back
	await sql`ALTER TABLE "subgraph_table_snapshots" RENAME TO "view_table_snapshots"`.execute(
		db,
	);
	await sql`ALTER TABLE "subgraph_processing_stats" RENAME TO "view_processing_stats"`.execute(
		db,
	);
	await sql`ALTER TABLE "subgraph_health_snapshots" RENAME TO "view_health_snapshots"`.execute(
		db,
	);
	await sql`ALTER TABLE "subgraphs" RENAME TO "views"`.execute(db);

	// Recreate old trigger
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
