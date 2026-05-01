import { type Kysely, sql } from "kysely";

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function up(db: Kysely<any>): Promise<void> {
	// ── workflow_definitions ──────────────────────────────────────────
	await db.schema
		.createTable("workflow_definitions")
		.addColumn("id", "uuid", (c) =>
			c.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("name", "text", (c) => c.notNull())
		.addColumn("version", "text", (c) => c.notNull().defaultTo("1.0.0"))
		.addColumn("status", "text", (c) => c.notNull().defaultTo("active"))
		.addColumn("trigger_type", "text", (c) => c.notNull())
		.addColumn("trigger_config", "jsonb", (c) => c.notNull())
		.addColumn("handler_path", "text", (c) => c.notNull())
		.addColumn("retries_config", "jsonb")
		.addColumn("timeout_ms", "integer")
		.addColumn("api_key_id", "uuid", (c) =>
			c.notNull().references("api_keys.id"),
		)
		.addColumn("project_id", "uuid", (c) =>
			c.references("projects.id").onDelete("set null"),
		)
		.addColumn("created_at", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.addColumn("updated_at", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.execute();

	await sql`CREATE UNIQUE INDEX workflow_definitions_name_key_idx ON workflow_definitions (name, api_key_id)`.execute(
		db,
	);
	await sql`CREATE INDEX workflow_definitions_status_idx ON workflow_definitions (status)`.execute(
		db,
	);

	// ── workflow_runs ─────────────────────────────────────────────────
	await db.schema
		.createTable("workflow_runs")
		.addColumn("id", "uuid", (c) =>
			c.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("definition_id", "uuid", (c) =>
			c.notNull().references("workflow_definitions.id").onDelete("cascade"),
		)
		.addColumn("status", "text", (c) => c.notNull().defaultTo("pending"))
		.addColumn("trigger_type", "text", (c) => c.notNull())
		.addColumn("trigger_data", "jsonb")
		.addColumn("dedup_key", "text")
		.addColumn("error", "text")
		.addColumn("started_at", "timestamptz")
		.addColumn("completed_at", "timestamptz")
		.addColumn("duration_ms", "integer")
		.addColumn("total_ai_tokens", "integer", (c) => c.notNull().defaultTo(0))
		.addColumn("created_at", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.execute();

	await sql`CREATE INDEX workflow_runs_definition_idx ON workflow_runs (definition_id, created_at DESC)`.execute(
		db,
	);
	await sql`CREATE INDEX workflow_runs_status_idx ON workflow_runs (status)`.execute(
		db,
	);
	await sql`CREATE UNIQUE INDEX workflow_runs_dedup_idx ON workflow_runs (definition_id, dedup_key) WHERE dedup_key IS NOT NULL`.execute(
		db,
	);

	// ── workflow_steps ────────────────────────────────────────────────
	await db.schema
		.createTable("workflow_steps")
		.addColumn("id", "uuid", (c) =>
			c.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("run_id", "uuid", (c) =>
			c.notNull().references("workflow_runs.id").onDelete("cascade"),
		)
		.addColumn("step_index", "integer", (c) => c.notNull())
		.addColumn("step_id", "text", (c) => c.notNull())
		.addColumn("step_type", "text", (c) => c.notNull())
		.addColumn("status", "text", (c) => c.notNull().defaultTo("pending"))
		.addColumn("input", "jsonb")
		.addColumn("output", "jsonb")
		.addColumn("error", "text")
		.addColumn("retry_count", "integer", (c) => c.notNull().defaultTo(0))
		.addColumn("ai_tokens_used", "integer", (c) => c.notNull().defaultTo(0))
		.addColumn("started_at", "timestamptz")
		.addColumn("completed_at", "timestamptz")
		.addColumn("duration_ms", "integer")
		.addColumn("created_at", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.execute();

	await sql`CREATE INDEX workflow_steps_run_idx ON workflow_steps (run_id, step_index)`.execute(
		db,
	);
	await sql`CREATE UNIQUE INDEX workflow_steps_dedup_idx ON workflow_steps (run_id, step_id)`.execute(
		db,
	);

	// ── workflow_queue ────────────────────────────────────────────────
	await db.schema
		.createTable("workflow_queue")
		.addColumn("id", "uuid", (c) =>
			c.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("run_id", "uuid", (c) =>
			c.notNull().references("workflow_runs.id").onDelete("cascade"),
		)
		.addColumn("status", "text", (c) => c.notNull().defaultTo("pending"))
		.addColumn("attempts", "integer", (c) => c.notNull().defaultTo(0))
		.addColumn("max_attempts", "integer", (c) => c.notNull().defaultTo(3))
		.addColumn("scheduled_for", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.addColumn("locked_at", "timestamptz")
		.addColumn("locked_by", "text")
		.addColumn("error", "text")
		.addColumn("created_at", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.addColumn("completed_at", "timestamptz")
		.execute();

	await sql`CREATE INDEX workflow_queue_poll_idx ON workflow_queue (scheduled_for, status, locked_at)`.execute(
		db,
	);

	// ── workflow_schedules ────────────────────────────────────────────
	await db.schema
		.createTable("workflow_schedules")
		.addColumn("id", "uuid", (c) =>
			c.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("definition_id", "uuid", (c) =>
			c.notNull().references("workflow_definitions.id").onDelete("cascade"),
		)
		.addColumn("cron_expr", "text", (c) => c.notNull())
		.addColumn("timezone", "text", (c) => c.notNull().defaultTo("UTC"))
		.addColumn("next_run_at", "timestamptz", (c) => c.notNull())
		.addColumn("last_run_at", "timestamptz")
		.addColumn("enabled", "boolean", (c) => c.notNull().defaultTo(true))
		.addColumn("created_at", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.execute();

	await sql`CREATE UNIQUE INDEX workflow_schedules_definition_idx ON workflow_schedules (definition_id)`.execute(
		db,
	);
	await sql`CREATE INDEX workflow_schedules_poll_idx ON workflow_schedules (enabled, next_run_at)`.execute(
		db,
	);

	// ── PG NOTIFY trigger on workflow_queue ───────────────────────────
	await sql`
		CREATE OR REPLACE FUNCTION notify_workflow_job() RETURNS trigger AS $$
		BEGIN
			PERFORM pg_notify('workflows:new_job', NEW.run_id::text);
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql
	`.execute(db);

	await sql`
		CREATE TRIGGER workflow_queue_notify
			AFTER INSERT ON workflow_queue
			FOR EACH ROW EXECUTE FUNCTION notify_workflow_job()
	`.execute(db);
}

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function down(db: Kysely<any>): Promise<void> {
	await sql`DROP TRIGGER IF EXISTS workflow_queue_notify ON workflow_queue`.execute(
		db,
	);
	await sql`DROP FUNCTION IF EXISTS notify_workflow_job`.execute(db);

	await sql`DROP INDEX IF EXISTS workflow_schedules_poll_idx`.execute(db);
	await sql`DROP INDEX IF EXISTS workflow_schedules_definition_idx`.execute(db);
	await db.schema.dropTable("workflow_schedules").execute();

	await sql`DROP INDEX IF EXISTS workflow_queue_poll_idx`.execute(db);
	await db.schema.dropTable("workflow_queue").execute();

	await sql`DROP INDEX IF EXISTS workflow_steps_dedup_idx`.execute(db);
	await sql`DROP INDEX IF EXISTS workflow_steps_run_idx`.execute(db);
	await db.schema.dropTable("workflow_steps").execute();

	await sql`DROP INDEX IF EXISTS workflow_runs_dedup_idx`.execute(db);
	await sql`DROP INDEX IF EXISTS workflow_runs_status_idx`.execute(db);
	await sql`DROP INDEX IF EXISTS workflow_runs_definition_idx`.execute(db);
	await db.schema.dropTable("workflow_runs").execute();

	await sql`DROP INDEX IF EXISTS workflow_definitions_status_idx`.execute(db);
	await sql`DROP INDEX IF EXISTS workflow_definitions_name_key_idx`.execute(db);
	await db.schema.dropTable("workflow_definitions").execute();
}
