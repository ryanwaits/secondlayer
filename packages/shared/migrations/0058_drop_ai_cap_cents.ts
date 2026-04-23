import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		ALTER TABLE account_spend_caps
			DROP COLUMN IF EXISTS ai_cap_cents
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`
		ALTER TABLE account_spend_caps
			ADD COLUMN IF NOT EXISTS ai_cap_cents integer
	`.execute(db);
}
