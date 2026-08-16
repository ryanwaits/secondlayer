import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * `archive_fetches` — the charge log for the metered archive fetch gate
 * (design-f089). One row per priced attempt to fetch a partition object,
 * successful or free (24h re-issue / monthly repair allowance). Never
 * updated after insert — it is an append-only log, read for two things:
 *
 *   - the 24h re-issue window: has this account already paid for this exact
 *     path recently, so a resumed/retried fetch re-presigns for free.
 *   - the monthly repair allowance: how many partitions this account has
 *     pulled via the free allowance this calendar month.
 *
 * `usd_micros` is 0 for allowance/re-issue rows, so summing it per account
 * is real revenue, not fetch volume. Lives on the control plane next to
 * `account_credits`, the balance it debits from.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);

		await sql`
			CREATE TABLE archive_fetches (
				id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				path          text NOT NULL,
				dataset       text NOT NULL,
				usd_micros    bigint NOT NULL,
				via_allowance boolean NOT NULL DEFAULT false,
				charged_at    timestamptz NOT NULL DEFAULT now(),
				UNIQUE (account_id, path, charged_at)
			)
		`.execute(db);

		// Serves both the 24h re-issue lookup (account_id, path, charged_at)
		// and the monthly allowance count (account_id, via_allowance, charged_at).
		await sql`
			CREATE INDEX archive_fetches_account_charged_at_idx
				ON archive_fetches (account_id, charged_at)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS archive_fetches`.execute(db);
	});
}
