import { type Kysely, sql } from "kysely";

/**
 * Switch tenant suspension from time-based (14-day trial) to activity-based
 * (Supabase-style auto-pause on the Hobby tier).
 *
 * - Drop `tenants.trial_ends_at` + its supporting index. The trial model
 *   is gone; no grandfathering (pre-launch, zero external users).
 * - Add `tenants.last_active_at timestamptz NOT NULL DEFAULT now()`. Bumped
 *   by tenant API middleware on 2xx responses + workflow-runner on run
 *   start. The new `tenant-idle-pause` cron suspends Hobby tenants idle
 *   beyond a threshold.
 * - Add `tenants_last_active_idx` for the cron's WHERE clause (plan +
 *   last_active_at).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await sql`DROP INDEX IF EXISTS tenants_trial_ends_idx`.execute(db);
	await sql`ALTER TABLE tenants DROP COLUMN IF EXISTS trial_ends_at`.execute(
		db,
	);
	await sql`
		ALTER TABLE tenants
			ADD COLUMN last_active_at timestamptz NOT NULL DEFAULT now()
	`.execute(db);
	await sql`
		CREATE INDEX tenants_last_active_idx
			ON tenants (plan, last_active_at)
			WHERE status = 'active'
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP INDEX IF EXISTS tenants_last_active_idx`.execute(db);
	await sql`ALTER TABLE tenants DROP COLUMN IF EXISTS last_active_at`.execute(
		db,
	);
	await sql`
		ALTER TABLE tenants
			ADD COLUMN trial_ends_at timestamptz NOT NULL DEFAULT (now() + interval '14 days')
	`.execute(db);
	await sql`
		CREATE INDEX tenants_trial_ends_idx
			ON tenants (trial_ends_at)
			WHERE status IN ('provisioning', 'active')
	`.execute(db);
}
