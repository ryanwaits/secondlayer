import { type Kysely, sql } from "kysely";

/**
 * Re-scope workflow AI usage to the account level.
 *
 * Sentries have no tenant (they're account-level), so the original
 * `workflow_ai_usage_daily` schema keyed on `(tenant_id, day)` can't
 * attribute a sentry's AI calls to an account. This migration:
 *
 *   1. Adds `account_id` (NOT NULL) and makes `tenant_id` nullable on
 *      `workflow_ai_usage_daily`.
 *   2. Drops the old PK, replaces with a UNIQUE index using
 *      `NULLS NOT DISTINCT` so two NULL-tenant rows for the same
 *      account+day conflict correctly (requires PG 15+, matches prod).
 *   3. Adds `account_id` + `tenant_id` nullable columns to
 *      `workflow_runs` so the processor can set AsyncLocalStorage
 *      context before invoking the handler — AI middleware reads this
 *      context to attribute usage back to the caller.
 *
 * Backfill for existing rows joins through `tenants.account_id`.
 * On prod the table has 0 rows (AI middleware was a no-op previously),
 * so backfill is a formality.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	// ── workflow_ai_usage_daily ──────────────────────────────────────
	await sql`
		ALTER TABLE workflow_ai_usage_daily
			ADD COLUMN account_id uuid REFERENCES accounts(id) ON DELETE CASCADE
	`.execute(db);

	await sql`
		UPDATE workflow_ai_usage_daily u
		SET account_id = t.account_id
		FROM tenants t
		WHERE u.tenant_id = t.id AND u.account_id IS NULL
	`.execute(db);

	// Drop any rows we couldn't backfill (orphans — tenant already deleted).
	await sql`DELETE FROM workflow_ai_usage_daily WHERE account_id IS NULL`.execute(
		db,
	);

	await sql`
		ALTER TABLE workflow_ai_usage_daily
			ALTER COLUMN account_id SET NOT NULL,
			ALTER COLUMN tenant_id DROP NOT NULL
	`.execute(db);

	// PK can't contain a nullable column. Drop the PK and use a unique
	// index with NULLS NOT DISTINCT (PG 15+) so account+day rows with
	// NULL tenant_id still enforce uniqueness.
	await sql`
		ALTER TABLE workflow_ai_usage_daily
			DROP CONSTRAINT workflow_ai_usage_daily_pkey
	`.execute(db);

	await sql`
		CREATE UNIQUE INDEX workflow_ai_usage_daily_account_tenant_day_key
			ON workflow_ai_usage_daily (account_id, tenant_id, day)
			NULLS NOT DISTINCT
	`.execute(db);

	await sql`DROP INDEX IF EXISTS workflow_ai_usage_daily_lookup_idx`.execute(
		db,
	);
	await sql`
		CREATE INDEX workflow_ai_usage_daily_account_day_idx
			ON workflow_ai_usage_daily (account_id, day DESC)
	`.execute(db);

	// ── workflow_runs ────────────────────────────────────────────────
	await sql`
		ALTER TABLE workflow_runs
			ADD COLUMN account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
			ADD COLUMN tenant_id  uuid REFERENCES tenants(id)  ON DELETE SET NULL
	`.execute(db);

	await sql`
		CREATE INDEX workflow_runs_account_idx
			ON workflow_runs (account_id, created_at DESC)
			WHERE account_id IS NOT NULL
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP INDEX IF EXISTS workflow_runs_account_idx`.execute(db);
	await sql`
		ALTER TABLE workflow_runs
			DROP COLUMN IF EXISTS account_id,
			DROP COLUMN IF EXISTS tenant_id
	`.execute(db);

	await sql`DROP INDEX IF EXISTS workflow_ai_usage_daily_account_day_idx`.execute(
		db,
	);
	await sql`DROP INDEX IF EXISTS workflow_ai_usage_daily_account_tenant_day_key`.execute(
		db,
	);
	// Best-effort: rows without tenant_id fill would violate NOT NULL on
	// revert. Assume down is dev-only.
	await sql`DELETE FROM workflow_ai_usage_daily WHERE tenant_id IS NULL`.execute(
		db,
	);
	await sql`
		ALTER TABLE workflow_ai_usage_daily
			ALTER COLUMN tenant_id SET NOT NULL,
			DROP COLUMN account_id
	`.execute(db);
}
