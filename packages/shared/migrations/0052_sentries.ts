import { type Kysely, sql } from "kysely";

/**
 * Protocol Sentry v1 — packaged monitoring product.
 *
 * `sentries` holds per-account enabled sentries. Worker cron ticks every
 * 60s, loads active rows, runs per-kind detect SQL on the shared indexer
 * DB, AI-triages matches, delivers to `delivery_webhook` (Slack-shape).
 *
 * `sentry_alerts` holds one row per delivered alert. UNIQUE on
 * (sentry_id, idempotency_key) dedupes across ticks — key is
 * sha256(txId:eventIndex) for the large-outflow kind.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		CREATE TABLE sentries (
			id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
			kind              text NOT NULL,
			name              text NOT NULL,
			config            jsonb NOT NULL,
			active            boolean NOT NULL DEFAULT true,
			last_check_at     timestamptz,
			delivery_webhook  text NOT NULL,
			created_at        timestamptz NOT NULL DEFAULT now(),
			updated_at        timestamptz NOT NULL DEFAULT now()
		)
	`.execute(db);

	await sql`CREATE INDEX sentries_account_idx ON sentries (account_id)`.execute(
		db,
	);
	await sql`
		CREATE INDEX sentries_tick_idx
			ON sentries (active, last_check_at NULLS FIRST)
			WHERE active = true
	`.execute(db);

	await sql`
		CREATE TABLE sentry_alerts (
			id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			sentry_id         uuid NOT NULL REFERENCES sentries(id) ON DELETE CASCADE,
			idempotency_key   text NOT NULL,
			fired_at          timestamptz NOT NULL DEFAULT now(),
			payload           jsonb NOT NULL,
			delivery_status   text NOT NULL DEFAULT 'pending',
			delivery_error    text,
			UNIQUE (sentry_id, idempotency_key)
		)
	`.execute(db);

	await sql`
		CREATE INDEX sentry_alerts_sentry_fired_idx
			ON sentry_alerts (sentry_id, fired_at DESC)
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TABLE IF EXISTS sentry_alerts`.execute(db);
	await sql`DROP TABLE IF EXISTS sentries`.execute(db);
}
