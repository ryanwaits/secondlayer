import { type Kysely, sql } from "kysely";
import { onChainPlane, onControlPlane } from "../src/db/migration-role.ts";

/**
 * Status columns that were bare `text` get a CHECK mirroring the TS union
 * that writes them. Each CHECK is added `NOT VALID` then validated, and is
 * skipped when its table is absent (not every database carries every table).
 *
 * Constraints here must match `AbiStatus` (queries/contracts.ts),
 * `OutboxStatus` and the api key statuses (db/types.ts), and the gap reasons
 * written by `subgraphs/src/runtime/{reindex,block-processor}.ts`.
 */

interface StatusCheck {
	table: string;
	name: string;
	expression: string;
}

const CHAIN_CHECKS: StatusCheck[] = [
	{
		table: "contracts",
		name: "contracts_abi_status_check",
		expression: "abi_status IN ('pending', 'fetched', 'unparseable', 'failed')",
	},
];

const CONTROL_CHECKS: StatusCheck[] = [
	{
		table: "webhook_outbox",
		name: "webhook_outbox_status_check",
		expression: "status IN ('pending', 'delivered', 'dead')",
	},
	{
		table: "api_keys",
		name: "api_keys_status_check",
		expression: "status IN ('active', 'revoked')",
	},
	{
		table: "api_keys",
		name: "api_keys_revoked_at_check",
		expression: "(status = 'revoked') = (revoked_at IS NOT NULL)",
	},
	{
		table: "subgraph_gaps",
		name: "subgraph_gaps_reason_check",
		expression: "reason IN ('processing_error', 'block_missing')",
	},
];

async function tableExists(db: Kysely<unknown>, table: string) {
	const { rows } = await sql<{ exists: boolean }>`
		SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS exists
	`.execute(db);
	return rows[0]?.exists === true;
}

async function addChecks(db: Kysely<unknown>, checks: StatusCheck[]) {
	for (const { table, name, expression } of checks) {
		if (!(await tableExists(db, table))) continue;
		await sql`ALTER TABLE ${sql.table(table)} DROP CONSTRAINT IF EXISTS ${sql.id(name)}`.execute(
			db,
		);
		await sql`
			ALTER TABLE ${sql.table(table)}
				ADD CONSTRAINT ${sql.id(name)} CHECK (${sql.raw(expression)}) NOT VALID
		`.execute(db);
		await sql`ALTER TABLE ${sql.table(table)} VALIDATE CONSTRAINT ${sql.id(name)}`.execute(
			db,
		);
	}
}

async function dropChecks(db: Kysely<unknown>, checks: StatusCheck[]) {
	for (const { table, name } of checks) {
		if (!(await tableExists(db, table))) continue;
		await sql`ALTER TABLE ${sql.table(table)} DROP CONSTRAINT IF EXISTS ${sql.id(name)}`.execute(
			db,
		);
	}
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onChainPlane(() => addChecks(db, CHAIN_CHECKS));
	await onControlPlane(() => addChecks(db, CONTROL_CHECKS));
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(() => dropChecks(db, CHAIN_CHECKS));
	await onControlPlane(() => dropChecks(db, CONTROL_CHECKS));
}
