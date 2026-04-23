import { type Kysely, sql } from "kysely";

/**
 * Legacy per-tenant-per-day model-call counter.
 *
 * The removed automation runtime bumped this on every model call. A daily
 * per-tier cap gated new calls when the cap was hit.
 *
 * The runtime package is gone and these tables are dropped by later cleanup.
 *
 * PK on (tenant_id, day) — one row per tenant per UTC day. `evals` is
 * the call count, `cost_usd_cents` is our internal cost estimate for
 * sanity-checking Stripe meter events later.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		CREATE TABLE workflow_ai_usage_daily (
			tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
			day             date NOT NULL,
			evals           integer NOT NULL DEFAULT 0,
			cost_usd_cents  integer NOT NULL DEFAULT 0,
			first_at        timestamptz NOT NULL DEFAULT now(),
			last_at         timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (tenant_id, day)
		)
	`.execute(db);

	await sql`
		CREATE INDEX workflow_ai_usage_daily_lookup_idx
			ON workflow_ai_usage_daily (tenant_id, day DESC)
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TABLE IF EXISTS workflow_ai_usage_daily`.execute(db);
}
