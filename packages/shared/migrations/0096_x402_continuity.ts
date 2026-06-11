import { sql } from "kysely";
import type { Kysely } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Wallet→account continuity (the x402 funnel).
 *
 * - `x402_payments.account_id`: once a wallet links to a claimed account, its
 *   historical on-chain payments attach here (nullable — accountless rows
 *   stay unlinked; SET NULL survives account deletion/sweeps).
 * - `x402_balances.spent_month` / `spent_month_usd_micros`: rolling
 *   month-bucketed consumption per principal — powers the "spent $X this
 *   month, Pro removes the meter" nudge without re-pricing ledger rows.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE x402_payments
			ADD COLUMN account_id UUID REFERENCES accounts(id) ON DELETE SET NULL
		`.execute(db);
		await sql`
			CREATE INDEX x402_payments_account_idx ON x402_payments (account_id)
			WHERE account_id IS NOT NULL
		`.execute(db);
		await sql`ALTER TABLE x402_balances ADD COLUMN spent_month TEXT`.execute(
			db,
		);
		await sql`
			ALTER TABLE x402_balances
			ADD COLUMN spent_month_usd_micros BIGINT NOT NULL DEFAULT 0
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`ALTER TABLE x402_balances DROP COLUMN IF EXISTS spent_month_usd_micros`.execute(
			db,
		);
		await sql`ALTER TABLE x402_balances DROP COLUMN IF EXISTS spent_month`.execute(
			db,
		);
		await sql`DROP INDEX IF EXISTS x402_payments_account_idx`.execute(db);
		await sql`ALTER TABLE x402_payments DROP COLUMN IF EXISTS account_id`.execute(
			db,
		);
	});
}
