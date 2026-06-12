import { sql } from "kysely";
import type { Kysely } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Operation scheduling weights + progress denominators.
 *
 * - `subgraph_operations.weight`: 'light' (contract-scoped sparse sync, cheap)
 *   vs 'heavy' (broad/non-sparse, hours-scale). The claim query budgets heavy
 *   ops so a whale sync can't hold every runner slot.
 * - `estimated_events` / `processed_events`: honest progress denominators —
 *   a sparse genesis sync reports "41% of ~38k events", not "0% of 8.25M
 *   blocks".
 * - `subgraphs.sparse_probe_targets`: the (event type, contract) pairs
 *   persisted at deploy, so reindex/backfill routes and the boot-resume sweep
 *   can classify weight without re-importing handler code.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE subgraph_operations
			ADD COLUMN weight TEXT NOT NULL DEFAULT 'heavy'
				CHECK (weight IN ('light', 'heavy'))
		`.execute(db);
		await sql`ALTER TABLE subgraph_operations ADD COLUMN estimated_events BIGINT`.execute(
			db,
		);
		await sql`ALTER TABLE subgraph_operations ADD COLUMN processed_events BIGINT`.execute(
			db,
		);
		await sql`ALTER TABLE subgraphs ADD COLUMN sparse_probe_targets JSONB`.execute(
			db,
		);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`ALTER TABLE subgraphs DROP COLUMN IF EXISTS sparse_probe_targets`.execute(
			db,
		);
		await sql`ALTER TABLE subgraph_operations DROP COLUMN IF EXISTS processed_events`.execute(
			db,
		);
		await sql`ALTER TABLE subgraph_operations DROP COLUMN IF EXISTS estimated_events`.execute(
			db,
		);
		await sql`ALTER TABLE subgraph_operations DROP COLUMN IF EXISTS weight`.execute(
			db,
		);
	});
}
