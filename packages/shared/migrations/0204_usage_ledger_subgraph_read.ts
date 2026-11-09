import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Replaces `usage_ledger_unit_check` from 0196 so the ledger accepts the
 * `subgraph.read` unit (hosted subgraph table reads, counted by the workload
 * gateway). Same shape as 0196: every priced `MeterUnit` (retired `sentinel.*`
 * included), `topup`, `grant`, `refund`; added `NOT VALID` so it binds every
 * new write without blocking the deploy on historical rows. Skipped when the
 * table is absent.
 *
 * Adding a unit means adding it to `prices.ts` AND to a new migration that
 * replaces `usage_ledger_unit_check`; `meter-invariants.test.ts` fails when the
 * two drift.
 */

const PREVIOUS_METER_UNITS = [
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
const METER_UNITS = [...PREVIOUS_METER_UNITS, "subgraph.read"];
const LEDGER_ONLY_UNITS = ["topup", "grant", "refund"];

function unitCheck(meterUnits: string[]): string {
	const list = [...meterUnits, ...LEDGER_ONLY_UNITS]
		.map((u) => `'${u}'`)
		.join(", ");
	return `unit IN (${list})`;
}

const NAME = "usage_ledger_unit_check";

async function tableExists(db: Kysely<unknown>, table: string) {
	const { rows } = await sql<{ exists: boolean }>`
		SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS exists
	`.execute(db);
	return rows[0]?.exists === true;
}

async function replaceUnitCheck(db: Kysely<unknown>, meterUnits: string[]) {
	await onControlPlane(async () => {
		if (!(await tableExists(db, "usage_ledger"))) return;
		await sql`ALTER TABLE usage_ledger DROP CONSTRAINT IF EXISTS ${sql.id(NAME)}`.execute(
			db,
		);
		await sql`
			ALTER TABLE usage_ledger
				ADD CONSTRAINT ${sql.id(NAME)} CHECK (${sql.raw(unitCheck(meterUnits))}) NOT VALID
		`.execute(db);
	});
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await replaceUnitCheck(db, METER_UNITS);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await replaceUnitCheck(db, PREVIOUS_METER_UNITS);
}
