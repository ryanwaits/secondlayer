import { type Kysely, sql } from "kysely";

/**
 * Per-tenant key generation counters. Each JWT carries a `gen` claim; the
 * tenant API rejects tokens whose `gen` doesn't match the current counter
 * for that role. Bumping a counter invalidates all JWTs of that role
 * immediately, without rotating the signing secret (which would force
 * both keys to rotate together).
 *
 * UX: user can rotate service alone (leaked server-side key) OR anon alone
 * (client-side embedding exposed) OR both together (offboarding panic).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);

	await sql`
		ALTER TABLE tenants
			ADD COLUMN service_gen integer NOT NULL DEFAULT 1,
			ADD COLUMN anon_gen integer NOT NULL DEFAULT 1
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`
		ALTER TABLE tenants
			DROP COLUMN IF EXISTS service_gen,
			DROP COLUMN IF EXISTS anon_gen
	`.execute(db);
}
