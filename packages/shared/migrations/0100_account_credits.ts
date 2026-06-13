import { sql } from "kysely";
import type { Kysely } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Prepaid dev credits — the card-funded peer to the wallet-funded
 * `x402_balances` rail.
 *
 * One running USD-micros balance per account. Stripe card top-ups
 * (`PaymentIntent`, one-time) credit it; metered reads / subgraph indexing
 * debit it atomically (`balance >= price` guard in the UPDATE, CHECK as the
 * backstop) — same mechanics as `x402_balances`, keyed by `account_id` instead
 * of a wallet principal. The prepaid balance is itself the hard bill-shock
 * ceiling; the rolling `spent_month_usd_micros` counter feeds an optional
 * per-account monthly cap (reuses `account_spend_caps`).
 *
 * Control plane (TARGET) — billing data alongside `accounts` / `x402_balances`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE account_credits (
				account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
				balance_usd_micros BIGINT NOT NULL DEFAULT 0 CHECK (balance_usd_micros >= 0),
				spent_month TEXT,
				spent_month_usd_micros BIGINT NOT NULL DEFAULT 0,
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS account_credits`.execute(db);
	});
}
