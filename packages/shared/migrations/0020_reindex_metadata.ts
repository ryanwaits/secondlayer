import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`ALTER TABLE subgraphs ADD COLUMN IF NOT EXISTS reindex_from_block bigint`.execute(
		db,
	);
	await sql`ALTER TABLE subgraphs ADD COLUMN IF NOT EXISTS reindex_to_block bigint`.execute(
		db,
	);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`ALTER TABLE subgraphs DROP COLUMN IF EXISTS reindex_from_block`.execute(
		db,
	);
	await sql`ALTER TABLE subgraphs DROP COLUMN IF EXISTS reindex_to_block`.execute(
		db,
	);
}
