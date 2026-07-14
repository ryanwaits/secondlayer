import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

// f071 Stage 2a: per-subgraph opt-in for the sandboxed (Bun Worker) handler
// execution path. Default FALSE everywhere — the global env flag
// (SUBGRAPH_SANDBOX_WORKERS) is the capability switch, this column is the
// per-tenant rollout switch; both must be true for a subgraph to route
// through the worker path (see runtime/sandbox/flag.ts). No subgraph is
// opted in by this migration — that's a later, separate cutover decision
// (Stage 2c). Control-plane (TARGET) — the subgraphs control-plane table.
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE subgraphs
				ADD COLUMN IF NOT EXISTS sandbox_workers BOOLEAN NOT NULL DEFAULT FALSE
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE subgraphs
				DROP COLUMN IF EXISTS sandbox_workers
		`.execute(db);
	});
}
