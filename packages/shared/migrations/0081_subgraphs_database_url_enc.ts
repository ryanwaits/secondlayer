import { type Kysely, sql } from "kysely";

// BYO data plane (subgraphs): per-subgraph user-owned Postgres connection
// string, stored as an AES-GCM envelope (crypto/secrets.ts) in a single bytea
// column on the subgraph row — same convention as subscriptions.signing_secret_enc
// and the old tenants.target_database_url_enc. Nullable; null = managed (handler
// writes + serving use the target DB, unchanged).
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`ALTER TABLE subgraphs ADD COLUMN database_url_enc BYTEA`.execute(
		db,
	);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`ALTER TABLE subgraphs DROP COLUMN database_url_enc`.execute(db);
}
