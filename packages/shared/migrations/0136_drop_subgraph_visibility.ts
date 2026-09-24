import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Drop `subgraphs.visibility` (from 0092). Publish/unpublish is gone, hosted
 * serves no subgraph reads, and self-host never read the column: who can
 * reach `/v1/subgraphs` is decided by the bind and the instance token.
 *
 * `down` restores the column and its partial unique index as 0092 made them.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`DROP INDEX IF EXISTS subgraphs_public_name_uidx`.execute(db);
		await sql`ALTER TABLE subgraphs DROP COLUMN IF EXISTS visibility`.execute(
			db,
		);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE subgraphs
			ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
			CHECK (visibility IN ('public', 'private'))
		`.execute(db);
		await sql`
			CREATE UNIQUE INDEX IF NOT EXISTS subgraphs_public_name_uidx
			ON subgraphs (name) WHERE visibility = 'public'
		`.execute(db);
	});
}
