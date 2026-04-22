import { type Kysely, sql } from "kysely";

/**
 * Per-account spending caps + threshold alert state.
 *
 * This is the anti-Supabase-#1-complaint differentiator: soft caps with
 * 80% threshold email alerts, per-line sub-caps, and a clear "frozen"
 * state the user can unfreeze by raising the cap (instead of Supabase's
 * binary cap that blocks certain line items but not compute, producing
 * surprise bills).
 *
 * One row per account (account_id is PK). Null caps mean "no cap" for
 * that line. `frozen_at` is set by the metering worker when a cap is
 * hit; cleared on the next billing cycle's `invoice.paid` webhook. While
 * frozen, meter events stop accumulating for that account.
 *
 * `alert_threshold_pct` default 80 — the Supabase request that's been
 * open since 2023.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		CREATE TABLE account_spend_caps (
			account_id              uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
			monthly_cap_cents       integer,
			compute_cap_cents       integer,
			storage_cap_cents       integer,
			ai_cap_cents            integer,
			alert_threshold_pct     integer NOT NULL DEFAULT 80,
			alert_sent_at           timestamptz,
			frozen_at               timestamptz,
			updated_at              timestamptz NOT NULL DEFAULT now()
		)
	`.execute(db);

	// Fast lookup for the metering crons: "is this account currently frozen?"
	await sql`
		CREATE INDEX account_spend_caps_frozen_idx
			ON account_spend_caps (account_id)
			WHERE frozen_at IS NOT NULL
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TABLE IF EXISTS account_spend_caps`.execute(db);
}
