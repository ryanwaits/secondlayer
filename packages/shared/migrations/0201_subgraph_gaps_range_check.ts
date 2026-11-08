import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * A gap is a range of blocks, so it starts at or before it ends. Rows written
 * backwards are swapped rather than dropped: the blocks they name are still
 * missing. The CHECK is added `NOT VALID` then validated, and skipped when the
 * table is absent (not every database carries it).
 */
async function tableExists(db: Kysely<unknown>, table: string) {
	const { rows } = await sql<{ exists: boolean }>`
		SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS exists
	`.execute(db);
	return rows[0]?.exists === true;
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		if (!(await tableExists(db, "subgraph_gaps"))) return;
		await sql`
			UPDATE subgraph_gaps
			SET gap_start = gap_end, gap_end = gap_start
			WHERE gap_start > gap_end
		`.execute(db);
		await sql`ALTER TABLE subgraph_gaps DROP CONSTRAINT IF EXISTS subgraph_gaps_range_check`.execute(
			db,
		);
		await sql`
			ALTER TABLE subgraph_gaps
				ADD CONSTRAINT subgraph_gaps_range_check CHECK (gap_start <= gap_end) NOT VALID
		`.execute(db);
		await sql`ALTER TABLE subgraph_gaps VALIDATE CONSTRAINT subgraph_gaps_range_check`.execute(
			db,
		);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		if (!(await tableExists(db, "subgraph_gaps"))) return;
		await sql`ALTER TABLE subgraph_gaps DROP CONSTRAINT IF EXISTS subgraph_gaps_range_check`.execute(
			db,
		);
	});
}
