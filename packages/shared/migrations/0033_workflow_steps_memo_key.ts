import { type Kysely, sql } from "kysely";

/**
 * v2 step memoization:
 *
 * 1. `memo_key` — SHA-256 of `(stepId, canonicalJSON(stableInputs))`. Replaces
 *    the v1 `(run_id, step_id)` lookup so that editing a prompt in source
 *    invalidates the cache on the next run. Partial UNIQUE allows legacy
 *    pre-v2 rows with NULL memo_key to coexist.
 *
 * 2. `parent_step_id` — nullable self-FK for sub-step rows. AI tool calls
 *    inside `generateText`/`generateObject` persist as children of the
 *    parent AI step; on retry, previously successful tool calls return
 *    cached results instead of re-invoking `execute`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.alterTable("workflow_steps")
		.addColumn("memo_key", "text")
		.addColumn("parent_step_id", "uuid", (c) =>
			c.references("workflow_steps.id").onDelete("cascade"),
		)
		.execute();

	// Drop v1 composite UNIQUE. Replaced by memo_key-based UNIQUE below.
	await sql`DROP INDEX IF EXISTS workflow_steps_dedup_idx`.execute(db);

	// Partial UNIQUE: only constrain rows with memo_key set (v2 rows).
	// Legacy NULL memo_key rows coexist without constraint violations.
	await sql`CREATE UNIQUE INDEX workflow_steps_memo_idx ON workflow_steps (run_id, memo_key) WHERE memo_key IS NOT NULL`.execute(
		db,
	);

	// Fan-out lookup for sub-step tool-call replay.
	await sql`CREATE INDEX workflow_steps_parent_idx ON workflow_steps (parent_step_id) WHERE parent_step_id IS NOT NULL`.execute(
		db,
	);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP INDEX IF EXISTS workflow_steps_parent_idx`.execute(db);
	await sql`DROP INDEX IF EXISTS workflow_steps_memo_idx`.execute(db);

	// Restore v1 composite UNIQUE.
	await sql`CREATE UNIQUE INDEX workflow_steps_dedup_idx ON workflow_steps (run_id, step_id)`.execute(
		db,
	);

	await db.schema
		.alterTable("workflow_steps")
		.dropColumn("parent_step_id")
		.dropColumn("memo_key")
		.execute();
}
