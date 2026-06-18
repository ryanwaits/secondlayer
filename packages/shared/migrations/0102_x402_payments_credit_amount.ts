import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

// R7 fix: a confirmed-tier deposit that broadcasts on-chain but does not turn
// canonical within the settle deadline used to throw `awaiting_confirmation`
// with NO ledger row — the payer was charged but never credited, unrecoverable.
// We now insert a `pending` deposit row up front and let the reconciler credit
// it on confirmation. The reconciler runs in the worker (no access to the API's
// USD↔token spot conversion), so the USD-micros to credit is persisted on the
// row here. NULL for non-deposit rows (per-call settles credit nothing).
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE x402_payments
				ADD COLUMN IF NOT EXISTS credit_usd_micros TEXT
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE x402_payments
				DROP COLUMN IF EXISTS credit_usd_micros
		`.execute(db);
	});
}
