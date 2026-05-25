import { type Kysely, sql } from "kysely";

// Adds a generic JSONB column for decoded event types whose payload doesn't fit
// the flat transfer columns — first consumer is `print` (topic + decoded Clarity
// value + raw hex). Nullable; every existing transfer row leaves it null.
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`ALTER TABLE decoded_events ADD COLUMN payload JSONB`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`ALTER TABLE decoded_events DROP COLUMN payload`.execute(db);
}
