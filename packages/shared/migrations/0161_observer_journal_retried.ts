import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

/**
 * Observer journal status `retried`: a `failed` row whose exact bytes (same
 * `raw_body_sha256`) were later `processed`, i.e. the node redelivered the
 * block and it succeeded. `failed` now means unresolved, which is what the
 * health check and canonical audit count. `error` stays on the row.
 *
 * Backfills existing rows with the same rule. `down` turns `retried` rows back
 * into `failed` before restoring the three-value constraint.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`ALTER TABLE observer_journal DROP CONSTRAINT observer_journal_status_check`.execute(
			db,
		);
		await sql`
			ALTER TABLE observer_journal ADD CONSTRAINT observer_journal_status_check
				CHECK (status IN ('received', 'processed', 'failed', 'retried'))
		`.execute(db);
		await sql`
			UPDATE observer_journal f SET status = 'retried'
			 WHERE f.status = 'failed'
			   AND EXISTS (
				SELECT 1 FROM observer_journal p
				 WHERE p.status = 'processed' AND p.network = f.network
				   AND p.raw_body_sha256 = f.raw_body_sha256
				   AND p.sequence > f.sequence
			   )
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`UPDATE observer_journal SET status = 'failed' WHERE status = 'retried'`.execute(
			db,
		);
		await sql`ALTER TABLE observer_journal DROP CONSTRAINT observer_journal_status_check`.execute(
			db,
		);
		await sql`
			ALTER TABLE observer_journal ADD CONSTRAINT observer_journal_status_check
				CHECK (status IN ('received', 'processed', 'failed'))
		`.execute(db);
	});
}
