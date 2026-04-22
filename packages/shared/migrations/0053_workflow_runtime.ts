import { type Kysely, sql } from "kysely";

/**
 * Workflow runtime tables (v3).
 *
 * Minimal revival of the runner's execution substrate after migration
 * 0038 dropped the v2 tables. No `workflow_definitions` — v3 is a
 * zero-sugar TS SDK, definitions live in compiled code + a process-
 * local registry, not the DB. No schedules / cursors / signer secrets
 * / budgets — consumers own their own scheduling; broadcast/budget
 * features land in later migrations when a consumer needs them.
 *
 *   workflow_runs    — one row per enqueued invocation
 *   workflow_steps   — memoized `step.*` outputs, keyed by
 *                      `sha256(stepId + canonicalJSON(inputs))`
 *   workflow_queue   — SKIP LOCKED dispatch table; one or more rows
 *                      per run (one per scheduling — sleeps re-enqueue)
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		CREATE TABLE workflow_runs (
			id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			workflow_name    text NOT NULL,
			input            jsonb NOT NULL DEFAULT '{}'::jsonb,
			status           text NOT NULL DEFAULT 'queued',
			output           jsonb,
			error            text,
			started_at       timestamptz,
			completed_at     timestamptz,
			created_at       timestamptz NOT NULL DEFAULT now()
		)
	`.execute(db);

	await sql`
		CREATE INDEX workflow_runs_name_status_idx
			ON workflow_runs (workflow_name, status, created_at DESC)
	`.execute(db);

	await sql`
		CREATE TABLE workflow_steps (
			id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			run_id           uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
			step_id          text NOT NULL,
			memo_key         text NOT NULL,
			status           text NOT NULL DEFAULT 'pending',
			output           jsonb,
			error            text,
			attempts         integer NOT NULL DEFAULT 0,
			started_at       timestamptz,
			completed_at     timestamptz,
			created_at       timestamptz NOT NULL DEFAULT now(),
			UNIQUE (run_id, memo_key)
		)
	`.execute(db);

	await sql`
		CREATE INDEX workflow_steps_run_idx
			ON workflow_steps (run_id, created_at ASC)
	`.execute(db);

	await sql`
		CREATE TABLE workflow_queue (
			id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			run_id           uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
			status           text NOT NULL DEFAULT 'pending',
			attempts         integer NOT NULL DEFAULT 0,
			max_attempts     integer NOT NULL DEFAULT 3,
			scheduled_for    timestamptz NOT NULL DEFAULT now(),
			locked_at        timestamptz,
			locked_by        text,
			error            text,
			completed_at     timestamptz,
			created_at       timestamptz NOT NULL DEFAULT now()
		)
	`.execute(db);

	await sql`
		CREATE INDEX workflow_queue_dispatch_idx
			ON workflow_queue (status, scheduled_for)
			WHERE status = 'pending'
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TABLE IF EXISTS workflow_queue CASCADE`.execute(db);
	await sql`DROP TABLE IF EXISTS workflow_steps CASCADE`.execute(db);
	await sql`DROP TABLE IF EXISTS workflow_runs CASCADE`.execute(db);
}
