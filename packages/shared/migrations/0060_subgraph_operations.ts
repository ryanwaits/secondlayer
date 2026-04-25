import { type Kysely, sql } from "kysely";

async function tableExists(db: Kysely<unknown>, tableName: string) {
	const { rows } = await sql<{ exists: boolean }>`
		SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS exists
	`.execute(db);
	return rows[0]?.exists === true;
}

export async function up(db: Kysely<unknown>): Promise<void> {
	if (!(await tableExists(db, "subgraphs"))) {
		console.log("Skipping subgraph_operations; subgraphs table is absent");
		return;
	}

	await sql`
		CREATE TABLE IF NOT EXISTS subgraph_operations (
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
		CREATE UNIQUE INDEX IF NOT EXISTS subgraph_operations_active_unique
			ON subgraph_operations (subgraph_id)
			WHERE status IN ('queued', 'running')
	`.execute(db);

	await sql`
		CREATE INDEX IF NOT EXISTS subgraph_operations_claim_idx
			ON subgraph_operations (created_at)
			WHERE status = 'queued'
	`.execute(db);

	await sql`
		CREATE INDEX IF NOT EXISTS subgraph_operations_stale_running_idx
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

	await sql`
		DROP TRIGGER IF EXISTS subgraph_operations_insert_notify ON subgraph_operations
	`.execute(db);
	await sql`
		CREATE TRIGGER subgraph_operations_insert_notify
			AFTER INSERT ON subgraph_operations
			FOR EACH ROW
			WHEN (NEW.status = 'queued')
			EXECUTE FUNCTION notify_subgraph_operation_new()
	`.execute(db);

	await sql`
		DROP TRIGGER IF EXISTS subgraph_operations_cancel_notify ON subgraph_operations
	`.execute(db);
	await sql`
		CREATE TRIGGER subgraph_operations_cancel_notify
			AFTER UPDATE OF cancel_requested ON subgraph_operations
			FOR EACH ROW
			WHEN (NEW.cancel_requested = true AND OLD.cancel_requested IS DISTINCT FROM NEW.cancel_requested)
			EXECUTE FUNCTION notify_subgraph_operation_new()
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	if (!(await tableExists(db, "subgraph_operations"))) {
		return;
	}

	await sql`
		DROP TRIGGER IF EXISTS subgraph_operations_cancel_notify ON subgraph_operations
	`.execute(db);
	await sql`
		DROP TRIGGER IF EXISTS subgraph_operations_insert_notify ON subgraph_operations
	`.execute(db);
	await sql`
		DROP FUNCTION IF EXISTS notify_subgraph_operation_new()
	`.execute(db);
	await sql`
		DROP INDEX IF EXISTS subgraph_operations_stale_running_idx
	`.execute(db);
	await sql`
		DROP INDEX IF EXISTS subgraph_operations_claim_idx
	`.execute(db);
	await sql`
		DROP INDEX IF EXISTS subgraph_operations_active_unique
	`.execute(db);
	await sql`
		DROP TABLE IF EXISTS subgraph_operations
	`.execute(db);
}
