import { sql } from "kysely";
import type { Kysely } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Op-scoped backfill checkpoint.
 *
 * Backfill walks revisit heights below the live subgraph cursor (tip-first
 * history fills, gap repair), so they can't use `subgraphs.last_processed_block`
 * as their crash checkpoint. `cursor_block` gives each backfill operation its
 * own monotonic cursor: written blocks advance it CONDITIONALLY inside the
 * same transaction as their row writes, replays skip at/below it, and a
 * resumed claim starts at cursor_block + 1.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`ALTER TABLE subgraph_operations ADD COLUMN cursor_block BIGINT`.execute(
			db,
		);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`ALTER TABLE subgraph_operations DROP COLUMN IF EXISTS cursor_block`.execute(
			db,
		);
	});
}
