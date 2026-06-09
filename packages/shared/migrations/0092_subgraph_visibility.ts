import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

// Subgraph read visibility. 'public' = anon-readable on /v1/subgraphs/:name
// (wildcard CORS, anon rate limits); 'private' = reads require the owning
// account's bearer key, anon resolution 404s. Existing rows default 'private'
// so nothing already deployed becomes world-readable; the public default for
// new managed deploys is applied at the API layer, not here. Public names are
// a single global namespace (claim-on-publish), enforced by the partial
// unique index. Control-plane (TARGET).
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE subgraphs
			ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'
			CHECK (visibility IN ('public', 'private'))
		`.execute(db);
		await sql`
			CREATE UNIQUE INDEX subgraphs_public_name_uidx
			ON subgraphs (name) WHERE visibility = 'public'
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP INDEX IF EXISTS subgraphs_public_name_uidx`.execute(db);
		await sql`ALTER TABLE subgraphs DROP COLUMN IF EXISTS visibility`.execute(
			db,
		);
	});
}
