import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * `usage_ledger` — one append-only row per billable (or free-allowance)
 * unit consumed, across every metered surface (archive fetch, hosted
 * Index/Streams reads, and future hosted-stack meters). Written by
 * `meter()` (`@secondlayer/platform/billing/meter`), the one function that
 * debits `account_credits`.
 *
 * `idempotency_key` is UNIQUE: a retried submission (a batched
 * `/internal/meters` call, a retried archive fetch) conflicts and no-ops
 * rather than double-charging. `debited` is false when the priced amount
 * could not be taken from the balance (short balance, spend cap) — the row
 * still exists so the gap is visible, never silently dropped.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE usage_ledger (
				id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				unit            text NOT NULL,
				quantity        bigint NOT NULL,
				usd_micros      bigint NOT NULL,
				debited         boolean NOT NULL DEFAULT true,
				source          text NOT NULL,
				idempotency_key text NOT NULL UNIQUE,
				occurred_at     timestamptz NOT NULL DEFAULT now(),
				recorded_at     timestamptz NOT NULL DEFAULT now()
			)
		`.execute(db);

		await sql`
			CREATE INDEX usage_ledger_account_occurred_at_idx
				ON usage_ledger (account_id, occurred_at)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS usage_ledger`.execute(db);
	});
}
