import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);

	// Name-lifecycle events from BNS-V2 (the `topic`-discriminated payloads):
	// new-name, transfer-name, renew-name, burn-name, new-airdrop.
	await sql`
		CREATE TABLE IF NOT EXISTS bns_name_events (
			cursor TEXT PRIMARY KEY,
			block_height BIGINT NOT NULL,
			block_time TIMESTAMPTZ NOT NULL,
			tx_id TEXT NOT NULL,
			tx_index INTEGER NOT NULL,
			event_index INTEGER NOT NULL,
			topic TEXT NOT NULL,
			namespace TEXT NOT NULL,
			name TEXT NOT NULL,
			fqn TEXT NOT NULL,
			owner TEXT,
			bns_id TEXT NOT NULL,
			registered_at BIGINT,
			imported_at BIGINT,
			renewal_height BIGINT,
			stx_burn TEXT,
			preordered_by TEXT,
			hashed_salted_fqn_preorder TEXT,
			canonical BOOLEAN NOT NULL DEFAULT true,
			source_cursor TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			CONSTRAINT bns_name_events_topic_check CHECK (topic IN (
				'new-name',
				'transfer-name',
				'renew-name',
				'burn-name',
				'new-airdrop'
			))
		)
	`.execute(db);

	await sql`CREATE INDEX IF NOT EXISTS bns_name_events_canonical_height_idx ON bns_name_events (canonical, block_height)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS bns_name_events_namespace_name_idx ON bns_name_events (namespace, name)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS bns_name_events_owner_height_idx ON bns_name_events (owner, block_height) WHERE owner IS NOT NULL`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS bns_name_events_topic_height_idx ON bns_name_events (topic, block_height)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS bns_name_events_bns_id_idx ON bns_name_events (bns_id)`.execute(
		db,
	);

	// Namespace-lifecycle events (the `status`-discriminated payloads).
	await sql`
		CREATE TABLE IF NOT EXISTS bns_namespace_events (
			cursor TEXT PRIMARY KEY,
			block_height BIGINT NOT NULL,
			block_time TIMESTAMPTZ NOT NULL,
			tx_id TEXT NOT NULL,
			tx_index INTEGER NOT NULL,
			event_index INTEGER NOT NULL,
			status TEXT NOT NULL,
			namespace TEXT NOT NULL,
			manager TEXT,
			manager_frozen BOOLEAN,
			manager_transfers_disabled BOOLEAN,
			price_function TEXT,
			price_frozen BOOLEAN,
			lifetime BIGINT,
			revealed_at BIGINT,
			launched_at BIGINT,
			canonical BOOLEAN NOT NULL DEFAULT true,
			source_cursor TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			CONSTRAINT bns_namespace_events_status_check CHECK (status IN (
				'launch',
				'transfer-manager',
				'freeze-manager',
				'update-price-manager',
				'freeze-price-manager',
				'turn-off-manager-transfers'
			))
		)
	`.execute(db);

	await sql`CREATE INDEX IF NOT EXISTS bns_namespace_events_canonical_height_idx ON bns_namespace_events (canonical, block_height)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS bns_namespace_events_namespace_status_idx ON bns_namespace_events (namespace, status)`.execute(
		db,
	);

	// Marketplace events (the `a`-discriminated payloads on the BNS-V2 NFT).
	await sql`
		CREATE TABLE IF NOT EXISTS bns_marketplace_events (
			cursor TEXT PRIMARY KEY,
			block_height BIGINT NOT NULL,
			block_time TIMESTAMPTZ NOT NULL,
			tx_id TEXT NOT NULL,
			tx_index INTEGER NOT NULL,
			event_index INTEGER NOT NULL,
			action TEXT NOT NULL,
			bns_id TEXT NOT NULL,
			price_ustx TEXT,
			commission TEXT,
			canonical BOOLEAN NOT NULL DEFAULT true,
			source_cursor TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			CONSTRAINT bns_marketplace_events_action_check CHECK (action IN (
				'list-in-ustx',
				'unlist-in-ustx',
				'buy-in-ustx'
			))
		)
	`.execute(db);

	await sql`CREATE INDEX IF NOT EXISTS bns_marketplace_events_canonical_height_idx ON bns_marketplace_events (canonical, block_height)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS bns_marketplace_events_bns_id_idx ON bns_marketplace_events (bns_id)`.execute(
		db,
	);

	// Current-state projection of names (decoder maintains via upsert).
	await sql`
		CREATE TABLE IF NOT EXISTS bns_names (
			fqn TEXT PRIMARY KEY,
			namespace TEXT NOT NULL,
			name TEXT NOT NULL,
			owner TEXT NOT NULL,
			bns_id TEXT NOT NULL,
			registered_at BIGINT,
			renewal_height BIGINT,
			last_event_cursor TEXT NOT NULL,
			last_event_at TIMESTAMPTZ NOT NULL,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`.execute(db);

	await sql`CREATE INDEX IF NOT EXISTS bns_names_owner_idx ON bns_names (owner)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS bns_names_namespace_registered_idx ON bns_names (namespace, registered_at)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS bns_names_renewal_height_idx ON bns_names (renewal_height) WHERE renewal_height IS NOT NULL`.execute(
		db,
	);

	// Current-state projection of namespaces.
	await sql`
		CREATE TABLE IF NOT EXISTS bns_namespaces (
			namespace TEXT PRIMARY KEY,
			manager TEXT,
			manager_frozen BOOLEAN NOT NULL DEFAULT false,
			price_frozen BOOLEAN NOT NULL DEFAULT false,
			lifetime BIGINT,
			launched_at BIGINT,
			last_event_cursor TEXT NOT NULL,
			last_event_at TIMESTAMPTZ NOT NULL,
			name_count INTEGER NOT NULL DEFAULT 0,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TABLE IF EXISTS bns_namespaces`.execute(db);
	await sql`DROP TABLE IF EXISTS bns_names`.execute(db);
	await sql`DROP TABLE IF EXISTS bns_marketplace_events`.execute(db);
	await sql`DROP TABLE IF EXISTS bns_namespace_events`.execute(db);
	await sql`DROP TABLE IF EXISTS bns_name_events`.execute(db);
}
