import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

// `credited_at` is the idempotency key for deposit crediting: stamped exactly
// once, whenever a deposit's balance credit is applied. Only a row where it's
// NULL is eligible for the reconciler's heal path (f069).
//
// THE TRAP: right after ADD COLUMN, every existing row (including historical
// `confirmed` deposits the old route-handler path already credited) has
// credited_at = NULL. If the reconciler treated NULL as "never credited" for
// those rows, it would DOUBLE-CREDIT every already-credited historical
// deposit. So we backfill all pre-existing non-pending deposit rows to a
// non-null sentinel (`updated_at`) — their true credit state is unknowable
// from ledger data alone, so healing must never touch them. `pending` rows
// stay NULL (not yet credited, still eligible once they confirm) and
// non-deposit rows stay NULL (they never carry a credit). Only rows created
// AFTER this migration are ever heal-eligible. Back-crediting truly-stranded
// historical rows is a separate founder payout decision, OUT OF SCOPE here.
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE x402_payments
				ADD COLUMN IF NOT EXISTS credited_at TIMESTAMPTZ
		`.execute(db);
		await sql`
			UPDATE x402_payments
				SET credited_at = updated_at
				WHERE kind = 'deposit' AND state <> 'pending' AND credited_at IS NULL
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE x402_payments
				DROP COLUMN IF EXISTS credited_at
		`.execute(db);
	});
}
