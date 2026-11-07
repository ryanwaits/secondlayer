import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * The ledger's shape, enforced where it is written. Mirrors what `meter()`,
 * `recordTopup`, `grantCredits` and the refund path assert in code
 * (`packages/platform/src/billing/meter.ts`):
 *
 * - `unit` is a known unit: every priced `MeterUnit` (retired `sentinel.*`
 *   included, their history rows still exist), `topup`, `grant`, `refund`.
 * - `quantity` is never negative.
 * - Sign: charges and refunds (money out) are `usd_micros >= 0`; top-ups and
 *   grants (money in) are `usd_micros <= 0`.
 *
 * Each CHECK is added `NOT VALID`: it binds every new write at once and never
 * blocks the deploy on a historical row. Run
 * `ALTER TABLE usage_ledger VALIDATE CONSTRAINT <name>` once the table has been
 * checked clean. Skipped when the table is absent.
 *
 * Adding a unit means adding it to `prices.ts` AND to a new migration that
 * replaces `usage_ledger_unit_check`; `meter-invariants.test.ts` fails when the
 * two drift.
 */

const METER_UNITS = [
	"archive.partition",
	"archive.partition.events",
	"rows.delivered",
	"memory.gb_hour",
	"storage.gb_day",
	"webhook.event",
	"sentinel.run",
	"sentinel.deep_audit",
	"sentinel.check_run",
	"sentinel.monitored_event",
];
const UNITS = [...METER_UNITS, "topup", "grant", "refund"];

const unitList = UNITS.map((u) => `'${u}'`).join(", ");

const CHECKS: { name: string; expression: string }[] = [
	{ name: "usage_ledger_unit_check", expression: `unit IN (${unitList})` },
	{
		name: "usage_ledger_quantity_nonnegative_check",
		expression: "quantity >= 0",
	},
	{
		name: "usage_ledger_usd_micros_sign_check",
		expression: `CASE WHEN unit IN ('topup', 'grant') THEN usd_micros <= 0 ELSE usd_micros >= 0 END`,
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
		if (!(await tableExists(db, "usage_ledger"))) return;
		for (const { name, expression } of CHECKS) {
			await sql`ALTER TABLE usage_ledger DROP CONSTRAINT IF EXISTS ${sql.id(name)}`.execute(
				db,
			);
			await sql`
				ALTER TABLE usage_ledger
					ADD CONSTRAINT ${sql.id(name)} CHECK (${sql.raw(expression)}) NOT VALID
			`.execute(db);
		}
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		if (!(await tableExists(db, "usage_ledger"))) return;
		for (const { name } of CHECKS) {
			await sql`ALTER TABLE usage_ledger DROP CONSTRAINT IF EXISTS ${sql.id(name)}`.execute(
				db,
			);
		}
	});
}
