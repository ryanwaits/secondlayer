import { type Kysely, sql } from "kysely";

/**
 * Compute add-ons on top of a plan's base spec.
 *
 * The two-axis model (plan × compute) needs somewhere to record "Pro +
 * 4 GB RAM bundle" without mutating the plan. Each row is one add-on;
 * SUM() over active rows for a tenant gives the delta to apply on top
 * of `plans.ts` base compute.
 *
 * Columns kept as *_delta so "zero add-ons" is the identity (no
 * nullables in the sum path). Effective compute = plan base +
 * SUM(active deltas).
 *
 * `effective_until` nullable — open-ended add-on (active until cancelled).
 * Ranges allow future-dated add-ons + mid-cycle cancels cleanly.
 *
 * `stripe_subscription_item_id` nullable — present once Sprint C.2/C.3
 * wire Stripe. For Sprint C.1 the table exists but nothing writes it.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		CREATE TABLE tenant_compute_addons (
			id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			tenant_id                   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
			memory_mb_delta             integer NOT NULL DEFAULT 0,
			cpu_delta                   numeric(4,2) NOT NULL DEFAULT 0,
			storage_mb_delta            integer NOT NULL DEFAULT 0,
			effective_from              timestamptz NOT NULL DEFAULT now(),
			effective_until             timestamptz,
			stripe_subscription_item_id text,
			created_at                  timestamptz NOT NULL DEFAULT now()
		)
	`.execute(db);

	// Partial index limited to open-ended add-ons (the common case) —
	// `now()` isn't immutable so it can't appear in a WHERE clause here.
	// Closed-end add-ons still get served from a seq scan + date filter,
	// which is cheap at our row counts.
	await sql`
		CREATE INDEX tenant_compute_addons_tenant_idx
			ON tenant_compute_addons (tenant_id)
			WHERE effective_until IS NULL
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TABLE IF EXISTS tenant_compute_addons`.execute(db);
}
