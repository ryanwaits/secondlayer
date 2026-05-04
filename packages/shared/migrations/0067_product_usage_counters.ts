import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await sql`
		ALTER TABLE usage_daily
			ADD COLUMN IF NOT EXISTS streams_events_returned integer NOT NULL DEFAULT 0,
			ADD COLUMN IF NOT EXISTS index_decoded_events_returned integer NOT NULL DEFAULT 0
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`
		ALTER TABLE usage_daily
			DROP COLUMN IF EXISTS index_decoded_events_returned,
			DROP COLUMN IF EXISTS streams_events_returned
	`.execute(db);
}
