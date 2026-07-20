import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);

	// PoX-5 (SIP-045) print events from the pox-5 boot contract. Unlike pox-4
	// (zero prints, decoded from contract-call args), pox-5 emits real print
	// events for every interesting action — 19 topics, tuple fields flattened
	// at top level alongside `topic`. Hot query paths get promoted typed
	// columns; the full decoded tuple always lands in `data` (covers nested
	// shapes: btc-lockup, bond-rewards lists, bond-periods).
	await sql`
		CREATE TABLE IF NOT EXISTS pox5_events (
			cursor TEXT PRIMARY KEY,
			block_height BIGINT NOT NULL,
			block_time TIMESTAMPTZ NOT NULL,
			tx_id TEXT NOT NULL,
			tx_index INTEGER NOT NULL,
			event_index INTEGER NOT NULL,
			topic TEXT NOT NULL,
			staker TEXT,
			signer TEXT,
			signer_manager TEXT,
			bond_index BIGINT,
			amount_ustx TEXT,
			amount_sats TEXT,
			reward_cycle INTEGER,
			first_reward_cycle INTEGER,
			unlock_cycle INTEGER,
			unlock_burn_height BIGINT,
			is_l1_lock BOOLEAN,
			signer_key TEXT,
			data JSONB NOT NULL,
			canonical BOOLEAN NOT NULL DEFAULT true,
			source_cursor TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			CONSTRAINT pox5_events_topic_check CHECK (topic IN (
				'set-bond-admin',
				'set-pause-admin',
				'pause-rewards',
				'setup-bond',
				'add-to-allowlist',
				'register-for-bond',
				'update-bond-registration',
				'register-signer',
				'stake',
				'stake-update',
				'announce-l1-early-exit',
				'unstake-sbtc',
				'unstake',
				'calculate-rewards',
				'bond-distribution',
				'claim-rewards',
				'claim-staker-rewards-for-signer',
				'grant-signer-key',
				'revoke-signer-grant'
			))
		)
	`.execute(db);

	await sql`CREATE INDEX IF NOT EXISTS pox5_events_canonical_height_idx ON pox5_events (canonical, block_height)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS pox5_events_topic_height_idx ON pox5_events (topic, block_height)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS pox5_events_staker_height_idx ON pox5_events (staker, block_height) WHERE staker IS NOT NULL`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS pox5_events_signer_height_idx ON pox5_events (signer, block_height) WHERE signer IS NOT NULL`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS pox5_events_signer_manager_height_idx ON pox5_events (signer_manager, block_height) WHERE signer_manager IS NOT NULL`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS pox5_events_bond_index_height_idx ON pox5_events (bond_index, block_height) WHERE bond_index IS NOT NULL`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS pox5_events_reward_cycle_topic_idx ON pox5_events (reward_cycle, topic) WHERE reward_cycle IS NOT NULL`.execute(
		db,
	);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TABLE IF EXISTS pox5_events`.execute(db);
}
