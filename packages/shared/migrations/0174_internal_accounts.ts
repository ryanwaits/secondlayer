import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * First-party accounts (Sentinel's service account): usage is still written
 * to `usage_ledger`, priced at $0, and no balance, floor or cap ever stops
 * them. Set by ops only; no route writes it.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE accounts ADD COLUMN IF NOT EXISTS internal boolean NOT NULL DEFAULT false
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`ALTER TABLE accounts DROP COLUMN IF EXISTS internal`.execute(db);
	});
}
