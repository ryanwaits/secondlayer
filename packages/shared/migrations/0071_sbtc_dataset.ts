import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);

	// Protocol-state events from sbtc-registry: completed-deposit,
	// withdrawal-create, withdrawal-accept, withdrawal-reject, key-rotation,
	// update-protocol-contract.
	await sql`
		CREATE TABLE IF NOT EXISTS sbtc_events (
			cursor TEXT PRIMARY KEY,
			block_height BIGINT NOT NULL,
			block_time TIMESTAMPTZ NOT NULL,
			tx_id TEXT NOT NULL,
			tx_index INTEGER NOT NULL,
			event_index INTEGER NOT NULL,
			topic TEXT NOT NULL,
			request_id BIGINT,
			amount TEXT,
			sender TEXT,
			recipient_btc_version INTEGER,
			recipient_btc_hashbytes TEXT,
			bitcoin_txid TEXT,
			output_index INTEGER,
			sweep_txid TEXT,
			burn_hash TEXT,
			burn_height BIGINT,
			signer_bitmap TEXT,
			max_fee TEXT,
			fee TEXT,
			block_height_at_request BIGINT,
			governance_contract_type INTEGER,
			governance_new_contract TEXT,
			signer_aggregate_pubkey TEXT,
			signer_threshold INTEGER,
			signer_address TEXT,
			signer_keys_count INTEGER,
			canonical BOOLEAN NOT NULL DEFAULT true,
			source_cursor TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			CONSTRAINT sbtc_events_topic_check CHECK (topic IN (
				'completed-deposit',
				'withdrawal-create',
				'withdrawal-accept',
				'withdrawal-reject',
				'key-rotation',
				'update-protocol-contract'
			))
		)
	`.execute(db);

	await sql`CREATE INDEX IF NOT EXISTS sbtc_events_canonical_height_idx ON sbtc_events (canonical, block_height)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS sbtc_events_topic_height_idx ON sbtc_events (topic, block_height)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS sbtc_events_request_id_idx ON sbtc_events (request_id) WHERE request_id IS NOT NULL`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS sbtc_events_bitcoin_txid_idx ON sbtc_events (bitcoin_txid) WHERE bitcoin_txid IS NOT NULL`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS sbtc_events_sender_height_idx ON sbtc_events (sender, block_height) WHERE sender IS NOT NULL`.execute(
		db,
	);

	// SIP-010 events on sbtc-token: transfer / mint / burn.
	await sql`
		CREATE TABLE IF NOT EXISTS sbtc_token_events (
			cursor TEXT PRIMARY KEY,
			block_height BIGINT NOT NULL,
			block_time TIMESTAMPTZ NOT NULL,
			tx_id TEXT NOT NULL,
			tx_index INTEGER NOT NULL,
			event_index INTEGER NOT NULL,
			event_type TEXT NOT NULL,
			sender TEXT,
			recipient TEXT,
			amount TEXT NOT NULL,
			memo TEXT,
			canonical BOOLEAN NOT NULL DEFAULT true,
			source_cursor TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			CONSTRAINT sbtc_token_events_type_check CHECK (event_type IN (
				'transfer',
				'mint',
				'burn'
			))
		)
	`.execute(db);

	await sql`CREATE INDEX IF NOT EXISTS sbtc_token_events_canonical_height_idx ON sbtc_token_events (canonical, block_height)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS sbtc_token_events_type_height_idx ON sbtc_token_events (event_type, block_height)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS sbtc_token_events_sender_height_idx ON sbtc_token_events (sender, block_height) WHERE sender IS NOT NULL`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS sbtc_token_events_recipient_height_idx ON sbtc_token_events (recipient, block_height) WHERE recipient IS NOT NULL`.execute(
		db,
	);

	// Daily supply rollup. Computed by the aggregator job.
	await sql`
		CREATE TABLE IF NOT EXISTS sbtc_supply_snapshots (
			date TEXT PRIMARY KEY,
			total_supply TEXT NOT NULL DEFAULT '0',
			mints_today TEXT NOT NULL DEFAULT '0',
			burns_today TEXT NOT NULL DEFAULT '0',
			deposit_count INTEGER NOT NULL DEFAULT 0,
			withdrawal_create_count INTEGER NOT NULL DEFAULT 0,
			withdrawal_accept_count INTEGER NOT NULL DEFAULT 0,
			withdrawal_reject_count INTEGER NOT NULL DEFAULT 0,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TABLE IF EXISTS sbtc_supply_snapshots`.execute(db);
	await sql`DROP TABLE IF EXISTS sbtc_token_events`.execute(db);
	await sql`DROP TABLE IF EXISTS sbtc_events`.execute(db);
}
