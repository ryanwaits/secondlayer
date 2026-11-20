import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Running `usage_ledger` total per account, unit and UTC month (`YYYY-MM` of
 * `occurred_at`). `claimLedgerEntry` bumps it in the same transaction that
 * writes the ledger row, so allowance checks read one row instead of summing
 * the month's ledger. Backfills the last 3 months — `/internal/meters` takes
 * items up to 35 days old, so no write lands further back.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE IF NOT EXISTS usage_monthly_totals (
				account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				unit       text NOT NULL,
				month      text NOT NULL,
				quantity   numeric NOT NULL DEFAULT 0,
				PRIMARY KEY (account_id, unit, month)
			)
		`.execute(db);
		await sql`
			INSERT INTO usage_monthly_totals (account_id, unit, month, quantity)
			SELECT account_id, unit,
				to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM'),
				sum(quantity)
			FROM usage_ledger
			WHERE occurred_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '2 months'
			GROUP BY 1, 2, 3
			ON CONFLICT (account_id, unit, month)
				DO UPDATE SET quantity = EXCLUDED.quantity
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS usage_monthly_totals`.execute(db);
	});
}
