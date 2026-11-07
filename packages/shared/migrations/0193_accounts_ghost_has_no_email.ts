import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * A ghost account (the owner of a signed-out reader's docs key) never has an
 * email: an account that gains one stops being a ghost. The CHECK is added
 * `NOT VALID` then validated, like the status checks in 0184; it fails
 * loudly if a database already holds a ghost with an email.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`
			ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_ghost_no_email_check
		`.execute(db);
		await sql`
			ALTER TABLE accounts
				ADD CONSTRAINT accounts_ghost_no_email_check
				CHECK (NOT ghost OR email IS NULL) NOT VALID
		`.execute(db);
		await sql`
			ALTER TABLE accounts VALIDATE CONSTRAINT accounts_ghost_no_email_check
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`
			ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_ghost_no_email_check
		`.execute(db);
	});
}
