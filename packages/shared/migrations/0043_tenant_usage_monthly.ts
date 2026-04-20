import { type Kysely, sql } from "kysely";

/**
 * Monthly usage snapshots for tenants. Billing lands later; this table
 * captures the raw measurements so we can backfill charges once pricing
 * ships.
 *
 * One row per (tenant_id, period_month). The period_month is the first
 * day of the calendar month in UTC (e.g. 2026-04-01). `storage_peak_mb`
 * is the max observation within the period; `measurements` counts how
 * many samples fed into peak/avg so we can judge confidence.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		CREATE TABLE tenant_usage_monthly (
			id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
			period_month    date NOT NULL,
			storage_peak_mb integer NOT NULL DEFAULT 0,
			storage_avg_mb  integer NOT NULL DEFAULT 0,
			storage_last_mb integer NOT NULL DEFAULT 0,
			measurements    integer NOT NULL DEFAULT 0,
			first_at        timestamptz NOT NULL DEFAULT now(),
			last_at         timestamptz NOT NULL DEFAULT now(),
			UNIQUE (tenant_id, period_month)
		)
	`.execute(db);
	await sql`
		CREATE INDEX tenant_usage_monthly_period_idx
			ON tenant_usage_monthly (period_month DESC)
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TABLE IF EXISTS tenant_usage_monthly`.execute(db);
}
