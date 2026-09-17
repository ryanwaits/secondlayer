import { type Kysely, sql } from "kysely";
import { onChainPlane, onControlPlane } from "../src/db/migration-role.ts";

/**
 * Drop four tables that were created, typed, and never written. Prod
 * 2026-09-17: count(*) = 0 on all four (source: pox4_cycles_daily,
 * pox4_signers_daily, sbtc_supply_snapshots; target: subgraph_table_snapshots).
 * Historical CREATE stays in 0014/0015/0070/0071.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onChainPlane(async () => {
		await sql`DROP TABLE IF EXISTS pox4_signers_daily CASCADE`.execute(db);
		await sql`DROP TABLE IF EXISTS pox4_cycles_daily CASCADE`.execute(db);
		await sql`DROP TABLE IF EXISTS sbtc_supply_snapshots CASCADE`.execute(db);
	});
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS subgraph_table_snapshots CASCADE`.execute(
			db,
		);
	});
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// Irreversible: the dropped tables were empty. Recreate from 0070/0071/0014.
}
