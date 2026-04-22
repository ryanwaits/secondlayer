import { type Kysely, sql } from "kysely";

/**
 * Tenant-scope the `usage_daily` table so Stripe metering (Sprint C) can
 * bill per-tenant, not per-account. Account-level billing worked when
 * accounts were 1:1 with tenants; once we adopt org-level billing where
 * an account owns multiple projects (each = one tenant), we need the
 * tenant dimension.
 *
 * - `tenant_id` added nullable — existing rows predate the column.
 *   Backfill is best-effort: rows where the account has exactly one
 *   tenant get that tenant's id; ambiguous rows stay NULL.
 * - Unique constraint relaxed from `(account_id, date)` to
 *   `(account_id, tenant_id, date)` (NULLs treated as distinct per
 *   Postgres default) so future per-tenant rows don't collide with
 *   account-level history.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);

	await sql`
		ALTER TABLE usage_daily
			ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL
	`.execute(db);

	// Best-effort backfill — only fill rows where the account has a single
	// tenant. Ambiguous accounts (multi-tenant) stay NULL; Sprint C starts
	// writing tenant_id on every new row.
	await sql`
		UPDATE usage_daily u
		SET tenant_id = t.id
		FROM tenants t
		WHERE u.tenant_id IS NULL
			AND t.account_id = u.account_id
			AND t.status <> 'deleted'
			AND NOT EXISTS (
				SELECT 1 FROM tenants t2
				WHERE t2.account_id = u.account_id
					AND t2.id <> t.id
					AND t2.status <> 'deleted'
			)
	`.execute(db);

	// Drop old PK/unique so we can widen to include tenant_id.
	await sql`
		ALTER TABLE usage_daily DROP CONSTRAINT IF EXISTS usage_daily_pkey
	`.execute(db);
	await sql`
		ALTER TABLE usage_daily
			ADD CONSTRAINT usage_daily_pkey
			UNIQUE (account_id, tenant_id, date)
	`.execute(db);

	await sql`
		CREATE INDEX IF NOT EXISTS usage_daily_tenant_date_idx
			ON usage_daily (tenant_id, date DESC)
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP INDEX IF EXISTS usage_daily_tenant_date_idx`.execute(db);
	await sql`
		ALTER TABLE usage_daily DROP CONSTRAINT IF EXISTS usage_daily_pkey
	`.execute(db);
	await sql`
		ALTER TABLE usage_daily
			ADD CONSTRAINT usage_daily_pkey
			PRIMARY KEY (account_id, date)
	`.execute(db);
	await sql`ALTER TABLE usage_daily DROP COLUMN IF EXISTS tenant_id`.execute(
		db,
	);
}
