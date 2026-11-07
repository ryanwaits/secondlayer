import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * One address, one account: `Foo@x.com` and `foo@x.com` collide. Every
 * writer lowercases (`normalizeEmail`); this index is the backstop. The
 * migration runner wraps each file in a transaction, so the index is built
 * plainly rather than CONCURRENTLY. It fails loudly if a database already
 * holds two accounts whose lowercased emails match. Ghost accounts have a
 * NULL email, which a unique index ignores.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`
			CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_lower_idx
				ON accounts (lower(email))
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`DROP INDEX IF EXISTS accounts_email_lower_idx`.execute(db);
	});
}
