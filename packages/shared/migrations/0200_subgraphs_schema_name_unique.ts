import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * One Postgres schema per subgraph. `schema_name` names the schema a
 * subgraph's rows live in; two rows sharing one would read and write each
 * other's tables. Names are capped at 54 characters so `subgraph_<name>` stays
 * within Postgres' 63-byte identifier limit instead of being truncated into a
 * collision, and this index makes the remaining collisions an error.
 *
 * Fails loudly if existing rows already share a schema, which needs a human to
 * decide whose rows are whose. Skipped when the table is absent (not every
 * database carries it).
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
		if (!(await tableExists(db, "subgraphs"))) return;
		await sql`
			CREATE UNIQUE INDEX IF NOT EXISTS subgraphs_schema_name_unique
				ON subgraphs (schema_name) WHERE schema_name IS NOT NULL
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		if (!(await tableExists(db, "subgraphs"))) return;
		await sql`DROP INDEX IF EXISTS subgraphs_schema_name_unique`.execute(db);
	});
}
