import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Owner-set billing thresholds can never be negative: the auto-refill trigger
 * and the monthly spend cap. Mirrors the route validation (`parseRefillInput`,
 * `parseCapsInput` in routes/billing.ts) so a write that skips the route still
 * cannot store one.
 *
 * Each CHECK is added `NOT VALID` then validated, and skipped when its table
 * is absent. A negative value already stored could only have come from the
 * unvalidated route, so it is cleared first: a null threshold is "off".
 */

interface NonNegativeCheck {
	table: string;
	column: string;
	name: string;
}

const CHECKS: NonNegativeCheck[] = [
	{
		table: "account_credits",
		column: "refill_below_usd_micros",
		name: "account_credits_refill_below_nonnegative_check",
	},
	{
		table: "account_spend_caps",
		column: "monthly_cap_cents",
		name: "account_spend_caps_monthly_cap_nonnegative_check",
	},
];

async function tableExists(db: Kysely<unknown>, table: string) {
	const { rows } = await sql<{ exists: boolean }>`
		SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS exists
	`.execute(db);
	return rows[0]?.exists === true;
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		for (const { table, column, name } of CHECKS) {
			if (!(await tableExists(db, table))) continue;
			await sql`
				UPDATE ${sql.table(table)} SET ${sql.id(column)} = NULL
				WHERE ${sql.id(column)} < 0
			`.execute(db);
			await sql`ALTER TABLE ${sql.table(table)} DROP CONSTRAINT IF EXISTS ${sql.id(name)}`.execute(
				db,
			);
			await sql`
				ALTER TABLE ${sql.table(table)}
					ADD CONSTRAINT ${sql.id(name)} CHECK (${sql.id(column)} >= 0) NOT VALID
			`.execute(db);
			await sql`ALTER TABLE ${sql.table(table)} VALIDATE CONSTRAINT ${sql.id(name)}`.execute(
				db,
			);
		}
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		for (const { table, name } of CHECKS) {
			if (!(await tableExists(db, table))) continue;
			await sql`ALTER TABLE ${sql.table(table)} DROP CONSTRAINT IF EXISTS ${sql.id(name)}`.execute(
				db,
			);
		}
	});
}
