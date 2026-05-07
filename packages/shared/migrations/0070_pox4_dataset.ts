import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);

	// Per-call decoded view of pox-4 contract calls. The PoX-4 contract emits
	// no print events; we decode tx-grain rows from the indexer's transactions
	// table when contract_id = pox-4 and the call succeeded.
	await sql`
		CREATE TABLE IF NOT EXISTS pox4_calls (
			cursor TEXT PRIMARY KEY,
			block_height BIGINT NOT NULL,
			block_time TIMESTAMPTZ NOT NULL,
			burn_block_height BIGINT NOT NULL,
			tx_id TEXT NOT NULL,
			tx_index INTEGER NOT NULL,
			function_name TEXT NOT NULL,
			caller TEXT NOT NULL,
			stacker TEXT,
			delegate_to TEXT,
			amount_ustx TEXT,
			lock_period INTEGER,
			pox_addr_version INTEGER,
			pox_addr_hashbytes TEXT,
			pox_addr_btc TEXT,
			start_cycle INTEGER,
			end_cycle INTEGER,
			signer_key TEXT,
			signer_signature TEXT,
			auth_id TEXT,
			max_amount TEXT,
			reward_cycle INTEGER,
			aggregated_amount_ustx TEXT,
			aggregated_signer_index INTEGER,
			auth_period INTEGER,
			auth_topic TEXT,
			auth_allowed BOOLEAN,
			result_ok BOOLEAN NOT NULL,
			result_raw TEXT NOT NULL,
			canonical BOOLEAN NOT NULL DEFAULT true,
			source_cursor TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			CONSTRAINT pox4_calls_function_check CHECK (function_name IN (
				'stack-stx',
				'delegate-stx',
				'stack-extend',
				'stack-increase',
				'revoke-delegate-stx',
				'delegate-stack-stx',
				'delegate-stack-extend',
				'delegate-stack-increase',
				'stack-aggregation-commit',
				'stack-aggregation-commit-indexed',
				'stack-aggregation-increase',
				'set-signer-key-authorization'
			))
		)
	`.execute(db);

	await sql`CREATE INDEX IF NOT EXISTS pox4_calls_canonical_height_idx ON pox4_calls (canonical, block_height)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS pox4_calls_stacker_height_idx ON pox4_calls (stacker, block_height) WHERE stacker IS NOT NULL`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS pox4_calls_delegate_to_height_idx ON pox4_calls (delegate_to, block_height) WHERE delegate_to IS NOT NULL`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS pox4_calls_signer_key_height_idx ON pox4_calls (signer_key, block_height) WHERE signer_key IS NOT NULL`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS pox4_calls_reward_cycle_function_idx ON pox4_calls (reward_cycle, function_name) WHERE reward_cycle IS NOT NULL`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS pox4_calls_cycle_range_idx ON pox4_calls (start_cycle, end_cycle) WHERE start_cycle IS NOT NULL`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS pox4_calls_function_height_idx ON pox4_calls (function_name, block_height)`.execute(
		db,
	);

	// Daily rollup per (date, reward_cycle) — derived from pox4_calls.
	await sql`
		CREATE TABLE IF NOT EXISTS pox4_cycles_daily (
			date TEXT NOT NULL,
			reward_cycle INTEGER NOT NULL,
			total_stacked_ustx TEXT NOT NULL DEFAULT '0',
			solo_stackers INTEGER NOT NULL DEFAULT 0,
			delegated_principals INTEGER NOT NULL DEFAULT 0,
			unique_pools INTEGER NOT NULL DEFAULT 0,
			unique_signers INTEGER NOT NULL DEFAULT 0,
			calls_today INTEGER NOT NULL DEFAULT 0,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (date, reward_cycle)
		)
	`.execute(db);

	await sql`CREATE INDEX IF NOT EXISTS pox4_cycles_daily_cycle_idx ON pox4_cycles_daily (reward_cycle, date)`.execute(
		db,
	);

	// Daily rollup per (date, reward_cycle, signer_key).
	await sql`
		CREATE TABLE IF NOT EXISTS pox4_signers_daily (
			date TEXT NOT NULL,
			reward_cycle INTEGER NOT NULL,
			signer_key TEXT NOT NULL,
			weight_ustx TEXT NOT NULL DEFAULT '0',
			stacker_count INTEGER NOT NULL DEFAULT 0,
			aggregation_calls INTEGER NOT NULL DEFAULT 0,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (date, reward_cycle, signer_key)
		)
	`.execute(db);

	await sql`CREATE INDEX IF NOT EXISTS pox4_signers_daily_cycle_idx ON pox4_signers_daily (reward_cycle, date)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS pox4_signers_daily_signer_idx ON pox4_signers_daily (signer_key, date)`.execute(
		db,
	);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TABLE IF EXISTS pox4_signers_daily`.execute(db);
	await sql`DROP TABLE IF EXISTS pox4_cycles_daily`.execute(db);
	await sql`DROP TABLE IF EXISTS pox4_calls`.execute(db);
}
