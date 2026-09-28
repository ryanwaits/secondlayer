import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Per-account preferences + debounce state for the balance-runway email
 * alerts (`packages/worker/src/jobs/balance-alert.ts`). One row per
 * account; a missing row means both alerts are on (the column defaults).
 * `sent_*_at` debounces each alert to once per crossing — cleared together
 * when the runway climbs back over 7 days (a top-up re-arms them).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE account_balance_alerts (
				account_id      uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
				notify_7d       boolean NOT NULL DEFAULT true,
				notify_2d       boolean NOT NULL DEFAULT true,
				sent_7d_at      timestamptz,
				sent_2d_at      timestamptz,
				sent_stopped_at timestamptz
			)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS account_balance_alerts`.execute(db);
	});
}
