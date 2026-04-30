import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		ALTER TABLE subscriptions
		ALTER COLUMN account_id TYPE text
		USING account_id::text
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`
		ALTER TABLE subscriptions
		ALTER COLUMN account_id TYPE uuid
		USING NULLIF(account_id, '')::uuid
	`.execute(db);
}
