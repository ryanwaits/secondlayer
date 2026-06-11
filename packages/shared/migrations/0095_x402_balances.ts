import { sql } from "kysely";
import type { Kysely } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Prepaid x402 credit.
 *
 * - `x402_balances`: one running USD-micros balance per payer principal.
 *   Deposits (confirmed-tier on-chain payments) credit it; per-call
 *   drawdowns debit it atomically (`balance >= price` guard in the UPDATE,
 *   CHECK as the backstop). No per-drawdown ledger rows — deposits are the
 *   on-chain accounting record.
 * - `x402_payments.kind`: distinguishes per-call payments from balance
 *   deposits in the existing ledger.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE x402_balances (
				principal TEXT PRIMARY KEY,
				balance_usd_micros BIGINT NOT NULL DEFAULT 0 CHECK (balance_usd_micros >= 0),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`.execute(db);
		await sql`
			ALTER TABLE x402_payments
			ADD COLUMN kind TEXT NOT NULL DEFAULT 'payment'
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`ALTER TABLE x402_payments DROP COLUMN IF EXISTS kind`.execute(db);
		await sql`DROP TABLE IF EXISTS x402_balances`.execute(db);
	});
}
