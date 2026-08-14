import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Opt-in archive-credit auto-refill. Null below = off (default).
 * Worker charges the saved card when balance drops under the threshold.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE account_credits
				ADD COLUMN IF NOT EXISTS refill_below_usd_micros BIGINT,
				ADD COLUMN IF NOT EXISTS refill_pack_usd INTEGER,
				ADD COLUMN IF NOT EXISTS refill_last_at TIMESTAMPTZ
		`.execute(db);
		await sql`
			ALTER TABLE account_credits
				DROP CONSTRAINT IF EXISTS account_credits_refill_pack_usd_check
		`.execute(db);
		await sql`
			ALTER TABLE account_credits
				ADD CONSTRAINT account_credits_refill_pack_usd_check
				CHECK (
					refill_pack_usd IS NULL
					OR refill_pack_usd IN (10, 25, 50, 100)
				)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE account_credits
				DROP CONSTRAINT IF EXISTS account_credits_refill_pack_usd_check
		`.execute(db);
		await sql`
			ALTER TABLE account_credits
				DROP COLUMN IF EXISTS refill_below_usd_micros,
				DROP COLUMN IF EXISTS refill_pack_usd,
				DROP COLUMN IF EXISTS refill_last_at
		`.execute(db);
	});
}
