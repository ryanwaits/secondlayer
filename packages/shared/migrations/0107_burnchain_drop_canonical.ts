import { type Kysely, sql } from "kysely";

// Drop the vestigial `canonical` column from the burnchain reward tables
// (plan f062). 0083 reserved it for a future mark-non-canonical reorg path;
// that path was never built and is now deliberately rejected: delete-by-
// height-then-insert (replace-per-height) IS the burnchain reorg contract.
// stacks-core re-announces /new_burn_block for every replaced height when it
// processes a burnchain fork (nakamoto coordinator processes each newly-
// canonical burn block lacking a sortition), so replacement heals reorgs of
// any depth height-by-height. The `(canonical, burn_block_height)` indexes
// led with a constant-true boolean; a plain height index now serves the
// handler's per-height DELETE. Tables are small (≤2 reward rows + slot rows
// per burn block), so in-place DDL under the 30s lock_timeout is fine.
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);

	await sql`DROP INDEX IF EXISTS burn_block_rewards_canonical_height_idx`.execute(
		db,
	);
	await sql`DROP INDEX IF EXISTS burn_block_reward_slots_canonical_height_idx`.execute(
		db,
	);

	await sql`CREATE INDEX IF NOT EXISTS burn_block_rewards_height_idx ON burn_block_rewards (burn_block_height)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS burn_block_reward_slots_height_idx ON burn_block_reward_slots (burn_block_height)`.execute(
		db,
	);

	await sql`ALTER TABLE burn_block_rewards DROP COLUMN IF EXISTS canonical`.execute(
		db,
	);
	await sql`ALTER TABLE burn_block_reward_slots DROP COLUMN IF EXISTS canonical`.execute(
		db,
	);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);

	await sql`ALTER TABLE burn_block_rewards ADD COLUMN IF NOT EXISTS canonical BOOLEAN NOT NULL DEFAULT true`.execute(
		db,
	);
	await sql`ALTER TABLE burn_block_reward_slots ADD COLUMN IF NOT EXISTS canonical BOOLEAN NOT NULL DEFAULT true`.execute(
		db,
	);

	await sql`CREATE INDEX IF NOT EXISTS burn_block_rewards_canonical_height_idx ON burn_block_rewards (canonical, burn_block_height)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS burn_block_reward_slots_canonical_height_idx ON burn_block_reward_slots (canonical, burn_block_height)`.execute(
		db,
	);

	await sql`DROP INDEX IF EXISTS burn_block_rewards_height_idx`.execute(db);
	await sql`DROP INDEX IF EXISTS burn_block_reward_slots_height_idx`.execute(
		db,
	);
}
