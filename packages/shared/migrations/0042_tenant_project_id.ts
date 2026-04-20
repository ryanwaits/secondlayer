import { type Kysely, sql } from "kysely";

/**
 * Link tenants to projects (1:1 enforced at application layer today;
 * schema supports 1:N for future branching).
 *
 * `ON DELETE SET NULL` so a project delete doesn't cascade into tenant
 * teardown — the tenant row stays (with project_id = NULL) until explicit
 * teardown via the provisioner.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await sql`
		ALTER TABLE tenants
			ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE SET NULL
	`.execute(db);
	await sql`CREATE INDEX IF NOT EXISTS tenants_project_idx ON tenants (project_id)`.execute(
		db,
	);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP INDEX IF EXISTS tenants_project_idx`.execute(db);
	await sql`ALTER TABLE tenants DROP COLUMN IF EXISTS project_id`.execute(db);
}
