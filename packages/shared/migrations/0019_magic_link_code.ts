import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`ALTER TABLE magic_links ADD COLUMN IF NOT EXISTS code text`.execute(
		db,
	);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`ALTER TABLE magic_links DROP COLUMN IF EXISTS code`.execute(db);
}
