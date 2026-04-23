import { type Kysely, sql } from "kysely";

/**
 * Subgraph event subscriptions — the new core surface after the workflow pivot.
 *
 * Three tables:
 *   - `subscriptions`: user-facing configuration. One row per subscription.
 *   - `subscription_outbox`: exactly-once emission ledger. Inserted inside the
 *     same tx as the row write, drained by the emitter worker.
 *   - `subscription_deliveries`: per-attempt HTTP dispatch log. Truncated
 *     response bodies + status code for UI + retention.
 *
 * Trigger `subscription_outbox_notify` fires `pg_notify('subscriptions:new_outbox', <sub_id>)`
 * on insert so the emitter can wake without polling.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		CREATE TABLE subscriptions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			account_id UUID NOT NULL,
			project_id UUID,
			name TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'active',
			subgraph_name TEXT NOT NULL,
			table_name TEXT NOT NULL,
			filter JSONB NOT NULL DEFAULT '{}'::jsonb,
			format TEXT NOT NULL DEFAULT 'standard-webhooks',
			runtime TEXT,
			url TEXT NOT NULL,
			signing_secret_enc BYTEA NOT NULL,
			auth_config JSONB NOT NULL DEFAULT '{}'::jsonb,
			max_retries INT NOT NULL DEFAULT 7,
			timeout_ms INT NOT NULL DEFAULT 10000,
			concurrency INT NOT NULL DEFAULT 4,
			circuit_failures INT NOT NULL DEFAULT 0,
			circuit_opened_at TIMESTAMPTZ,
			last_delivery_at TIMESTAMPTZ,
			last_success_at TIMESTAMPTZ,
			last_error TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE (account_id, name)
		)
	`.execute(db);

	await sql`
		CREATE INDEX subscriptions_matcher_idx
			ON subscriptions (subgraph_name, table_name, status)
			WHERE status = 'active'
	`.execute(db);

	await sql`
		CREATE INDEX subscriptions_account_idx ON subscriptions (account_id)
	`.execute(db);

	await sql`
		CREATE TABLE subscription_outbox (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
			subgraph_name TEXT NOT NULL,
			table_name TEXT NOT NULL,
			block_height BIGINT NOT NULL,
			tx_id TEXT,
			row_pk JSONB NOT NULL,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL,
			dedup_key TEXT NOT NULL,
			attempt INT NOT NULL DEFAULT 0,
			next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			status TEXT NOT NULL DEFAULT 'pending',
			is_replay BOOLEAN NOT NULL DEFAULT FALSE,
			delivered_at TIMESTAMPTZ,
			failed_at TIMESTAMPTZ,
			locked_by TEXT,
			locked_until TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE (subscription_id, dedup_key)
		)
	`.execute(db);

	await sql`
		CREATE INDEX outbox_dispatch_idx
			ON subscription_outbox (status, next_attempt_at, is_replay)
			WHERE status = 'pending'
	`.execute(db);

	await sql`
		CREATE INDEX outbox_sub_idx
			ON subscription_outbox (subscription_id, created_at DESC)
	`.execute(db);

	await sql`
		CREATE TABLE subscription_deliveries (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			outbox_id UUID NOT NULL REFERENCES subscription_outbox(id) ON DELETE CASCADE,
			subscription_id UUID NOT NULL,
			attempt INT NOT NULL,
			status_code INT,
			response_headers JSONB,
			response_body TEXT,
			error_message TEXT,
			duration_ms INT,
			dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`.execute(db);

	await sql`
		CREATE INDEX deliveries_sub_idx
			ON subscription_deliveries (subscription_id, dispatched_at DESC)
	`.execute(db);

	await sql`
		CREATE OR REPLACE FUNCTION notify_new_outbox() RETURNS TRIGGER AS $$
		BEGIN
			PERFORM pg_notify('subscriptions:new_outbox', NEW.subscription_id::text);
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql
	`.execute(db);

	await sql`
		CREATE TRIGGER subscription_outbox_notify
			AFTER INSERT ON subscription_outbox
			FOR EACH ROW
			EXECUTE FUNCTION notify_new_outbox()
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TRIGGER IF EXISTS subscription_outbox_notify ON subscription_outbox`.execute(
		db,
	);
	await sql`DROP FUNCTION IF EXISTS notify_new_outbox() CASCADE`.execute(db);
	await sql`DROP TABLE IF EXISTS subscription_deliveries CASCADE`.execute(db);
	await sql`DROP TABLE IF EXISTS subscription_outbox CASCADE`.execute(db);
	await sql`DROP TABLE IF EXISTS subscriptions CASCADE`.execute(db);
}
