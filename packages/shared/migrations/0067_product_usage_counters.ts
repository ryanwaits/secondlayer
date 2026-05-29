import { type Kysely, sql } from "kysely";

// biome-ignore lint/suspicious/noExplicitAny: migration DDL is intentionally schema-dynamic
export async function up(db: Kysely<any>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await sql`
		ALTER TABLE usage_daily
			ADD COLUMN IF NOT EXISTS streams_events_returned integer NOT NULL DEFAULT 0,
			ADD COLUMN IF NOT EXISTS index_decoded_events_returned integer NOT NULL DEFAULT 0
	`.execute(db);
}

// biome-ignore lint/suspicious/noExplicitAny: migration DDL is intentionally schema-dynamic
export async function down(db: Kysely<any>): Promise<void> {
	await sql`
		ALTER TABLE usage_daily
			DROP COLUMN IF EXISTS index_decoded_events_returned,
			DROP COLUMN IF EXISTS streams_events_returned
	`.execute(db);
}
