import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * The instance row remembers a canary sealed under `SECONDLAYER_SECRETS_KEY`,
 * so a self-hosted boot can tell the key it was handed from the one that
 * encrypted this database's webhook signing secrets. NULL until the first
 * boot that has the key writes it. Skipped when the table is absent (not
 * every database carries it).
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
		if (!(await tableExists(db, "instances"))) return;
		await sql`ALTER TABLE instances ADD COLUMN IF NOT EXISTS secrets_key_canary TEXT`.execute(
			db,
		);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		if (!(await tableExists(db, "instances"))) return;
		await sql`ALTER TABLE instances DROP COLUMN IF EXISTS secrets_key_canary`.execute(
			db,
		);
	});
}
