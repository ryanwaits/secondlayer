import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		ALTER TABLE decoded_events
			ADD COLUMN microblock_hash TEXT,
			ADD COLUMN canonical BOOLEAN NOT NULL DEFAULT true,
			ADD COLUMN contract_id TEXT,
			ADD COLUMN sender TEXT,
			ADD COLUMN recipient TEXT,
			ADD COLUMN amount TEXT,
			ADD COLUMN asset_identifier TEXT,
			ADD COLUMN value TEXT,
			ADD COLUMN memo TEXT
	`.execute(db);

	await sql`
		UPDATE decoded_events
		SET
			contract_id = decoded_payload->>'contract_id',
			sender = decoded_payload->>'sender',
			recipient = decoded_payload->>'recipient',
			amount = decoded_payload->>'amount',
			asset_identifier = decoded_payload->>'asset_identifier'
		WHERE event_type = 'ft_transfer'
	`.execute(db);

	await sql`ALTER TABLE decoded_events DROP COLUMN decoded_payload`.execute(db);

	await sql`
		CREATE INDEX decoded_events_contract_height_event_idx
		ON decoded_events (contract_id, block_height, event_index)
	`.execute(db);
	await sql`
		CREATE INDEX decoded_events_sender_height_event_idx
		ON decoded_events (sender, block_height, event_index)
	`.execute(db);
	await sql`
		CREATE INDEX decoded_events_recipient_height_event_idx
		ON decoded_events (recipient, block_height, event_index)
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP INDEX IF EXISTS decoded_events_recipient_height_event_idx`.execute(
		db,
	);
	await sql`DROP INDEX IF EXISTS decoded_events_sender_height_event_idx`.execute(
		db,
	);
	await sql`DROP INDEX IF EXISTS decoded_events_contract_height_event_idx`.execute(
		db,
	);

	await sql`ALTER TABLE decoded_events ADD COLUMN decoded_payload JSONB`.execute(
		db,
	);
	await sql`
		UPDATE decoded_events
		SET decoded_payload = jsonb_strip_nulls(jsonb_build_object(
			'contract_id', contract_id,
			'sender', sender,
			'recipient', recipient,
			'amount', amount,
			'asset_identifier', asset_identifier,
			'value', value,
			'memo', memo
		))
	`.execute(db);
	await sql`
		ALTER TABLE decoded_events
			ALTER COLUMN decoded_payload SET NOT NULL,
			DROP COLUMN memo,
			DROP COLUMN value,
			DROP COLUMN asset_identifier,
			DROP COLUMN amount,
			DROP COLUMN recipient,
			DROP COLUMN sender,
			DROP COLUMN contract_id,
			DROP COLUMN canonical,
			DROP COLUMN microblock_hash
	`.execute(db);
}
