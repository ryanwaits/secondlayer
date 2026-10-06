import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

// The subprocess handler sandbox is gone (hosted stacks isolate handlers with
// gVisor), so its per-subgraph opt-in column has no reader. Control-plane
// (TARGET) — the subgraphs control-plane table.
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE subgraphs
				DROP COLUMN IF EXISTS sandbox_workers
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE subgraphs
				ADD COLUMN IF NOT EXISTS sandbox_workers BOOLEAN NOT NULL DEFAULT FALSE
		`.execute(db);
	});
}
