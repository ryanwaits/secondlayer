import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

// x402 payment ledger. Accountless x402 payers are entirely outside the
// account-keyed usage/billing path (countApiRequests / emitMeterEvent / freeze
// all short-circuit on a missing accountId), so per-payment accounting needs its
// own table — keyed by the challenge nonce + settled txid, not account_id.
// Control-plane (TARGET): written by the API on settle, read by reconcilers.
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE x402_payments (
				id BIGSERIAL PRIMARY KEY,
				nonce TEXT NOT NULL UNIQUE,
				txid TEXT NOT NULL UNIQUE,
				asset TEXT NOT NULL,
				amount TEXT NOT NULL,
				payer TEXT NOT NULL,
				surface TEXT NOT NULL,
				state TEXT NOT NULL DEFAULT 'pending'
					CHECK (state IN ('pending', 'confirmed', 'reverted')),
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`.execute(db);
		// Velocity/abuse queries scan by payer; reconcilers scan by state.
		await sql`CREATE INDEX x402_payments_payer_idx ON x402_payments (payer)`.execute(
			db,
		);
		await sql`CREATE INDEX x402_payments_state_idx ON x402_payments (state)`.execute(
			db,
		);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS x402_payments`.execute(db);
	});
}
