import { type Kysely, sql } from "kysely";

/**
 * Audit trail of provisioning-facing lifecycle events. Captures what
 * happened, who triggered it, and the outcome — source of truth for
 * post-incident review and billing disputes.
 *
 * `tenant_id` is nullable so provision-start rows (where the tenant row
 * does not yet exist) can be recorded alongside lifecycle events on an
 * existing tenant.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		CREATE TABLE provisioning_audit_log (
			id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			tenant_id    uuid REFERENCES tenants(id) ON DELETE SET NULL,
			tenant_slug  text,
			account_id   uuid REFERENCES accounts(id) ON DELETE SET NULL,
			actor        text NOT NULL,
			event        text NOT NULL,
			status       text NOT NULL,
			detail       jsonb,
			error        text,
			created_at   timestamptz NOT NULL DEFAULT now()
		)
	`.execute(db);
	await sql`CREATE INDEX provisioning_audit_tenant_idx ON provisioning_audit_log (tenant_id, created_at DESC)`.execute(
		db,
	);
	await sql`CREATE INDEX provisioning_audit_account_idx ON provisioning_audit_log (account_id, created_at DESC)`.execute(
		db,
	);
	await sql`CREATE INDEX provisioning_audit_event_idx ON provisioning_audit_log (event, created_at DESC)`.execute(
		db,
	);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TABLE IF EXISTS provisioning_audit_log`.execute(db);
}
