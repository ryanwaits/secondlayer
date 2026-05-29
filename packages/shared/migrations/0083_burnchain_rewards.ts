import { type Kysely, sql } from "kysely";

// Burnchain (Bitcoin) PoX reward data, sourced from the stacks-node
// /new_burn_block event observer payload (reward_recipients / reward_slot_holders),
// which the indexer previously discarded. Two views per burn block:
//   - burn_block_rewards: actual BTC payouts (one row per reward slot, ≤2/block).
//     Populated only during a reward cycle's reward phase.
//   - burn_block_reward_slots: reward-set membership (eligible BTC addresses).
// Both are keyed by (burn_block_height, index) via `cursor`; the handler does
// delete-by-height-then-insert (replace-per-height), which makes redelivery and
// shallow burnchain reorgs idempotent. `canonical` is reserved for a future
// mark-non-canonical reorg path; v1 keeps every row canonical.
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);

	await sql`
		CREATE TABLE IF NOT EXISTS burn_block_rewards (
			cursor TEXT PRIMARY KEY,
			burn_block_height BIGINT NOT NULL,
			burn_block_hash TEXT NOT NULL,
			reward_index INTEGER NOT NULL,
			recipient_btc TEXT NOT NULL,
			amount_sats TEXT NOT NULL,
			burn_amount TEXT NOT NULL DEFAULT '0',
			canonical BOOLEAN NOT NULL DEFAULT true,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`.execute(db);

	await sql`CREATE INDEX IF NOT EXISTS burn_block_rewards_canonical_height_idx ON burn_block_rewards (canonical, burn_block_height)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS burn_block_rewards_recipient_height_idx ON burn_block_rewards (recipient_btc, burn_block_height)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS burn_block_rewards_hash_idx ON burn_block_rewards (burn_block_hash)`.execute(
		db,
	);

	await sql`
		CREATE TABLE IF NOT EXISTS burn_block_reward_slots (
			cursor TEXT PRIMARY KEY,
			burn_block_height BIGINT NOT NULL,
			burn_block_hash TEXT NOT NULL,
			slot_index INTEGER NOT NULL,
			holder_btc TEXT NOT NULL,
			canonical BOOLEAN NOT NULL DEFAULT true,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`.execute(db);

	await sql`CREATE INDEX IF NOT EXISTS burn_block_reward_slots_canonical_height_idx ON burn_block_reward_slots (canonical, burn_block_height)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS burn_block_reward_slots_holder_height_idx ON burn_block_reward_slots (holder_btc, burn_block_height)`.execute(
		db,
	);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TABLE IF EXISTS burn_block_reward_slots`.execute(db);
	await sql`DROP TABLE IF EXISTS burn_block_rewards`.execute(db);
}
