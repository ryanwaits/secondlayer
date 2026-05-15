import { type Kysely, sql } from "kysely";

/**
 * Restore `subgraphs` + `subgraph_operations` on platform DBs that lost them
 * during the shared→dedicated cutover (manual drop after 0041; see note in
 * 0045). After the 2026-05-14 shared-rip pivot, the platform subgraph-processor
 * crashes with `relation "subgraphs" does not exist` because no migration ever
 * recreated the parent table — only the satellite tables (gaps, stats,
 * snapshots, usage_daily) survived.
 *
 * Idempotent: each step is guarded so this is a no-op on DBs that already have
 * the tables (OSS, fresh dev, or any tenant DB).
 */

async function tableExists(
	db: Kysely<unknown>,
	tableName: string,
): Promise<boolean> {
	const { rows } = await sql<{ exists: boolean }>`
		SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS exists
	`.execute(db);
	return rows[0]?.exists === true;
}

export async function up(db: Kysely<unknown>): Promise<void> {
	if (!(await tableExists(db, "subgraphs"))) {
		await sql`
			CREATE TABLE subgraphs (
				id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				name text NOT NULL,
				version text NOT NULL DEFAULT '1.0.0',
				status text NOT NULL DEFAULT 'active',
				definition jsonb NOT NULL,
				schema_hash text NOT NULL,
				handler_path text NOT NULL,
				schema_name text,
				start_block bigint NOT NULL DEFAULT 0,
				last_processed_block bigint NOT NULL DEFAULT 0,
				reindex_from_block bigint,
				reindex_to_block bigint,
				last_error text,
				last_error_at timestamptz,
				total_processed bigint NOT NULL DEFAULT 0,
				total_errors bigint NOT NULL DEFAULT 0,
				account_id text NOT NULL,
				handler_code text,
				source_code text,
				project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
				created_at timestamptz NOT NULL DEFAULT now(),
				updated_at timestamptz NOT NULL DEFAULT now()
			)
		`.execute(db);

		await sql`CREATE INDEX subgraphs_name_idx ON subgraphs (name)`.execute(db);
		await sql`CREATE INDEX subgraphs_status_idx ON subgraphs (status)`.execute(
			db,
		);
		await sql`CREATE UNIQUE INDEX subgraphs_name_account_id_unique ON subgraphs (name, account_id)`.execute(
			db,
		);
		await sql`CREATE INDEX subgraphs_account_id_idx ON subgraphs (account_id)`.execute(
			db,
		);

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

		await sql`DROP TRIGGER IF EXISTS subgraphs_notify_trigger ON subgraphs`.execute(
			db,
		);
		await sql`
			CREATE TRIGGER subgraphs_notify_trigger
				AFTER INSERT OR UPDATE OR DELETE ON subgraphs
				FOR EACH ROW EXECUTE FUNCTION notify_subgraph_changes()
		`.execute(db);
	}

	if (!(await tableExists(db, "subgraph_operations"))) {
		await sql`
			CREATE TABLE subgraph_operations (
				id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				subgraph_id uuid NOT NULL REFERENCES subgraphs(id) ON DELETE CASCADE,
				subgraph_name text NOT NULL,
				account_id text,
				kind text NOT NULL CHECK (kind IN ('reindex', 'backfill')),
				status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
				from_block bigint,
				to_block bigint,
				cancel_requested boolean NOT NULL DEFAULT false,
				locked_by text,
				locked_until timestamptz,
				started_at timestamptz,
				finished_at timestamptz,
				processed_blocks bigint,
				error text,
				created_at timestamptz NOT NULL DEFAULT now(),
				updated_at timestamptz NOT NULL DEFAULT now()
			)
		`.execute(db);

		await sql`
			CREATE UNIQUE INDEX subgraph_operations_active_unique
				ON subgraph_operations (subgraph_id)
				WHERE status IN ('queued', 'running')
		`.execute(db);

		await sql`
			CREATE INDEX subgraph_operations_claim_idx
				ON subgraph_operations (created_at)
				WHERE status = 'queued'
		`.execute(db);

		await sql`
			CREATE INDEX subgraph_operations_stale_running_idx
				ON subgraph_operations (locked_until)
				WHERE status = 'running'
		`.execute(db);

		await sql`
			CREATE OR REPLACE FUNCTION notify_subgraph_operation_new()
			RETURNS trigger AS $$
			BEGIN
				PERFORM pg_notify('subgraph_operations:new', NEW.id::text);
				RETURN NEW;
			END;
			$$ LANGUAGE plpgsql
		`.execute(db);

		await sql`DROP TRIGGER IF EXISTS subgraph_operations_insert_notify ON subgraph_operations`.execute(
			db,
		);
		await sql`
			CREATE TRIGGER subgraph_operations_insert_notify
				AFTER INSERT ON subgraph_operations
				FOR EACH ROW
				WHEN (NEW.status = 'queued')
				EXECUTE FUNCTION notify_subgraph_operation_new()
		`.execute(db);

		await sql`DROP TRIGGER IF EXISTS subgraph_operations_cancel_notify ON subgraph_operations`.execute(
			db,
		);
		await sql`
			CREATE TRIGGER subgraph_operations_cancel_notify
				AFTER UPDATE OF cancel_requested ON subgraph_operations
				FOR EACH ROW
				WHEN (NEW.cancel_requested = true AND OLD.cancel_requested IS DISTINCT FROM NEW.cancel_requested)
				EXECUTE FUNCTION notify_subgraph_operation_new()
		`.execute(db);
	}
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// No-op. Rolling back would drop tables that existed pre-migration on the
	// dedicated-tenant + OSS code paths and risk data loss on platform once the
	// processor starts writing. If a true rollback is needed, do it manually.
}
