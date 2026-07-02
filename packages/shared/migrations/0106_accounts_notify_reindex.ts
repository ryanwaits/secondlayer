import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Opt-out toggle for the subgraph reindex-completion email. Defaults to true —
 * reindex completion is rare and high-value (the customer explicitly triggered
 * a wait), unlike a recurring digest that would want opt-in.
 *
 * `accounts` is control-plane (TARGET) only under the source/target split —
 * gate with `onControlPlane` so this is a no-op (not a failure) on SOURCE,
 * which doesn't have the table.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE accounts
				ADD COLUMN IF NOT EXISTS notify_reindex_complete boolean NOT NULL DEFAULT true
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE accounts DROP COLUMN IF EXISTS notify_reindex_complete
		`.execute(db);
	});
}
