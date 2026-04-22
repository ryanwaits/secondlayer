import { type Kysely, sql } from "kysely";

/**
 * Normalize the legacy `free` plan string to `hobby`.
 *
 * Migration 0004 originally set `accounts.plan` default to `"free"` when
 * the tier vocabulary was free/pro/builder. The pricing model later
 * settled on `hobby/launch/grow/scale/enterprise`. Every lookup table
 * (pricing.ts allowances, TIER_META, webhook handlers) is keyed on
 * `hobby` — but existing signups still carry `plan='free'`, breaking
 * the usage + billing pages' tier mapping.
 *
 * This migration:
 *   1. Backfills existing rows: `free` → `hobby`
 *   2. Flips the column default so new signups default to `hobby`
 *
 * No paid accounts are affected (no existing `plan` value maps to a
 * current tier except `hobby` and whatever a webhook has written).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`UPDATE accounts SET plan = 'hobby' WHERE plan = 'free'`.execute(db);
	await sql`ALTER TABLE accounts ALTER COLUMN plan SET DEFAULT 'hobby'`.execute(
		db,
	);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`ALTER TABLE accounts ALTER COLUMN plan SET DEFAULT 'free'`.execute(
		db,
	);
	await sql`UPDATE accounts SET plan = 'free' WHERE plan = 'hobby'`.execute(db);
}
