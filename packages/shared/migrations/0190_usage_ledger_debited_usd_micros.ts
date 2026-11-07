import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * `usage_ledger.debited_usd_micros` — the amount actually taken from the
 * balance for the row. A clamped stack charge can take part of its price, which
 * the boolean `debited` could not say; unpaid = `usd_micros - debited_usd_micros`.
 *
 * Existing rows backfill from the boolean: `debited` → the whole price, else 0.
 * (A pre-existing partial take was recorded as `debited = false` with the full
 * price, so those rows read as fully unpaid; the true partial amount was never
 * stored and cannot be recovered.) Top-up and grant rows carry a negative
 * `usd_micros`, so the CHECK bounds the column between 0 and the price in
 * either direction.
 *
 * The column defaults to 0 so a writer that predates it (a deploy that lags the
 * migration) still inserts. Re-run the backfill `UPDATE` below after the new
 * code is live to repair any such rows.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`
			ALTER TABLE usage_ledger
				ADD COLUMN IF NOT EXISTS debited_usd_micros bigint NOT NULL DEFAULT 0
		`.execute(db);
		await sql`
			UPDATE usage_ledger
				SET debited_usd_micros = usd_micros
				WHERE debited AND debited_usd_micros = 0 AND usd_micros <> 0
		`.execute(db);
		await sql`
			ALTER TABLE usage_ledger
				DROP CONSTRAINT IF EXISTS usage_ledger_debited_usd_micros_check
		`.execute(db);
		await sql`
			ALTER TABLE usage_ledger
				ADD CONSTRAINT usage_ledger_debited_usd_micros_check
				CHECK (debited_usd_micros BETWEEN LEAST(0, usd_micros) AND GREATEST(0, usd_micros))
				NOT VALID
		`.execute(db);
		await sql`
			ALTER TABLE usage_ledger
				VALIDATE CONSTRAINT usage_ledger_debited_usd_micros_check
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE usage_ledger
				DROP CONSTRAINT IF EXISTS usage_ledger_debited_usd_micros_check
		`.execute(db);
		await sql`ALTER TABLE usage_ledger DROP COLUMN IF EXISTS debited_usd_micros`.execute(
			db,
		);
	});
}
