import { type Kysely, sql } from "kysely";

/**
 * Workflow budget counters — one row per `(workflow_definition_id, period)`.
 * The runner increments these in `budget/enforcer.ts` after each AI/chain/
 * run event and refuses further work when any configured cap is reached.
 *
 * `period` is a string key derived from the `WorkflowDefinition.budget.reset`
 * setting and the current wall-clock: `"daily:2026-04-17"`,
 * `"weekly:2026-W16"`, or `"per-run:<runId>"`. Old periods are retained for
 * historical observability (budget burn-down view); a weekly TTL cron
 * prunes them past 30 days of history.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable("workflow_budgets")
		.addColumn("id", "uuid", (c) =>
			c.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("workflow_definition_id", "uuid", (c) =>
			c.notNull().references("workflow_definitions.id").onDelete("cascade"),
		)
		.addColumn("period", "text", (c) => c.notNull())
		.addColumn("ai_usd_used", "numeric(12, 4)", (c) => c.notNull().defaultTo(0))
		.addColumn("ai_tokens_used", "bigint", (c) => c.notNull().defaultTo(0))
		.addColumn("chain_microstx_used", "numeric(30, 0)", (c) =>
			c.notNull().defaultTo(0),
		)
		.addColumn("chain_tx_count", "integer", (c) => c.notNull().defaultTo(0))
		.addColumn("run_count", "integer", (c) => c.notNull().defaultTo(0))
		.addColumn("step_count", "integer", (c) => c.notNull().defaultTo(0))
		.addColumn("reset_at", "timestamptz", (c) => c.notNull())
		.addColumn("created_at", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.addColumn("updated_at", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.execute();

	await sql`CREATE UNIQUE INDEX workflow_budgets_def_period_idx ON workflow_budgets (workflow_definition_id, period)`.execute(
		db,
	);
	await sql`CREATE INDEX workflow_budgets_reset_at_idx ON workflow_budgets (reset_at)`.execute(
		db,
	);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP INDEX IF EXISTS workflow_budgets_reset_at_idx`.execute(db);
	await sql`DROP INDEX IF EXISTS workflow_budgets_def_period_idx`.execute(db);
	await db.schema.dropTable("workflow_budgets").execute();
}
