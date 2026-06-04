import { type Kysely, sql } from "kysely";

// Direct chain-level subscriptions ("lambda for Stacks"): let a webhook target a
// contract / event-type / function-call (or a trait like all SIP-010) WITHOUT
// deploying a subgraph. A subscription is now polymorphic — `kind='subgraph'`
// (the existing subgraph_name + table_name + column filter) XOR `kind='chain'`
// (a `triggers` array of chain filters). A new evaluator loop reads the public
// Index/Streams clock, matches triggers, and writes to subscription_outbox; the
// existing emitter delivers both kinds unchanged. `kind` is an explicit
// discriminator (do NOT infer chain rows from event_type strings).
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);

	// subscriptions: add the polymorphic columns, relax the subgraph-only NOT
	// NULLs, and enforce exactly-one-mode via CHECK. Existing rows default to
	// kind='subgraph' and already satisfy the constraint.
	await sql`ALTER TABLE subscriptions ADD COLUMN kind TEXT NOT NULL DEFAULT 'subgraph'`.execute(
		db,
	);
	await sql`ALTER TABLE subscriptions ADD COLUMN triggers JSONB`.execute(db);
	await sql`ALTER TABLE subscriptions ALTER COLUMN subgraph_name DROP NOT NULL`.execute(
		db,
	);
	await sql`ALTER TABLE subscriptions ALTER COLUMN table_name DROP NOT NULL`.execute(
		db,
	);
	await sql`
		ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_kind_shape CHECK (
			(kind = 'subgraph' AND subgraph_name IS NOT NULL AND table_name IS NOT NULL AND triggers IS NULL)
			OR
			(kind = 'chain' AND triggers IS NOT NULL AND subgraph_name IS NULL AND table_name IS NULL)
		)
	`.execute(db);

	// subscription_outbox: chain rows carry neither subgraph_name nor table_name.
	// Add an explicit kind discriminator so reorg/cleanup queries don't depend on
	// event_type string matching.
	await sql`ALTER TABLE subscription_outbox ADD COLUMN kind TEXT NOT NULL DEFAULT 'subgraph'`.execute(
		db,
	);
	await sql`ALTER TABLE subscription_outbox ALTER COLUMN subgraph_name DROP NOT NULL`.execute(
		db,
	);
	await sql`ALTER TABLE subscription_outbox ALTER COLUMN table_name DROP NOT NULL`.execute(
		db,
	);
	// Reorg rollback path snapshots chain outbox rows at/above the fork point.
	await sql`CREATE INDEX subscription_outbox_chain_height_idx ON subscription_outbox (block_height) WHERE kind = 'chain'`.execute(
		db,
	);

	// Single global high-water mark for the trigger evaluator (one loop serves
	// ALL chain subscriptions). The boolean-PK + CHECK enforces exactly one row.
	await sql`
		CREATE TABLE trigger_evaluator_state (
			id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
			last_processed_block BIGINT NOT NULL DEFAULT 0,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`.execute(db);
	await sql`INSERT INTO trigger_evaluator_state (id) VALUES (TRUE)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	// Reverting the feature abandons chain subscriptions. Delete them before
	// dropping `kind` so surviving rows are all subgraph-shaped — otherwise a
	// later re-`up` would default them to kind='subgraph' and violate the
	// re-added CHECK (chain rows have null subgraph_name/table_name). Outbox rows
	// cascade via the subscription_id FK.
	await sql`DELETE FROM subscriptions WHERE kind = 'chain'`.execute(db);
	await sql`DROP TABLE IF EXISTS trigger_evaluator_state`.execute(db);
	await sql`DROP INDEX IF EXISTS subscription_outbox_chain_height_idx`.execute(
		db,
	);
	await sql`ALTER TABLE subscription_outbox DROP COLUMN IF EXISTS kind`.execute(
		db,
	);
	await sql`ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_kind_shape`.execute(
		db,
	);
	await sql`ALTER TABLE subscriptions DROP COLUMN IF EXISTS triggers`.execute(
		db,
	);
	await sql`ALTER TABLE subscriptions DROP COLUMN IF EXISTS kind`.execute(db);
	// Leaves subgraph_name/table_name nullable; existing rows remain valid.
}
