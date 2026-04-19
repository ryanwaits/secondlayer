import { type Kysely, sql } from "kysely";

/**
 * Dedicated-hosting tenant registry.
 *
 * One row per customer instance. Provisioner is stateless — it does Docker
 * ops + returns values; control plane (this table) owns the persistent
 * mapping between accounts and their per-tenant stack.
 *
 * Encrypted fields use `packages/shared/src/crypto/secrets.ts` (AES-GCM
 * envelope keyed by `SECONDLAYER_SECRETS_KEY`). Never log them in plaintext.
 *
 * Storage is soft-enforced: `storage_used_mb` is updated by the health
 * cron; alerts + overage billing live in the control plane, not the DB.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);

	await sql`
		CREATE TABLE tenants (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
			slug text NOT NULL UNIQUE,
			status text NOT NULL DEFAULT 'provisioning',

			plan text NOT NULL,
			cpus numeric(4,2) NOT NULL,
			memory_mb integer NOT NULL,
			storage_limit_mb integer NOT NULL,
			storage_used_mb integer,

			pg_container_id text,
			api_container_id text,
			processor_container_id text,

			target_database_url_enc bytea NOT NULL,
			tenant_jwt_secret_enc bytea NOT NULL,
			anon_key_enc bytea NOT NULL,
			service_key_enc bytea NOT NULL,

			api_url_internal text NOT NULL,
			api_url_public text NOT NULL,

			trial_ends_at timestamptz NOT NULL,
			suspended_at timestamptz,
			last_health_check_at timestamptz,

			created_at timestamptz NOT NULL DEFAULT now(),
			updated_at timestamptz NOT NULL DEFAULT now()
		)
	`.execute(db);

	await sql`CREATE INDEX tenants_account_idx ON tenants (account_id)`.execute(
		db,
	);
	await sql`CREATE INDEX tenants_status_idx ON tenants (status) WHERE status <> 'deleted'`.execute(
		db,
	);
	await sql`CREATE INDEX tenants_trial_ends_idx ON tenants (trial_ends_at) WHERE status IN ('provisioning', 'active')`.execute(
		db,
	);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TABLE IF EXISTS tenants`.execute(db);
}
