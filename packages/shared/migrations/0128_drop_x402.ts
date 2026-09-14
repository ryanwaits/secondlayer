import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Drop the deleted x402 pay-per-call tables. The rail 404s; no live queries
 * remain. Prod leftover rows (payments + balances) are intentionally dropped.
 *
 * `down` is a no-op — recreating empty tables cannot restore those rows, and
 * the creating migrations (0091/0095/…) remain the historical schema record.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`DROP TABLE IF EXISTS x402_payments`.execute(db);
		await sql`DROP TABLE IF EXISTS x402_balances`.execute(db);
	});
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// No-op: cannot restore dropped payment/balance rows.
}
