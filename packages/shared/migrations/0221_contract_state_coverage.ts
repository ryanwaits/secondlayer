import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

// One row: which canonical blocks have no `state_writes` rows (the node never
// delivered their writes), scanned through a finalized height and shared by
// every API process. `claimed_at` marks the one process running a scan pass.
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onChainPlane(async () => {
		await sql`
			CREATE TABLE IF NOT EXISTS contract_state_coverage (
				id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
				from_height BIGINT,
				checked_through BIGINT,
				gaps JSONB NOT NULL DEFAULT '[]'::jsonb,
				gap_heights BIGINT NOT NULL DEFAULT 0,
				updated_at TIMESTAMPTZ,
				claimed_at TIMESTAMPTZ
			)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`DROP TABLE IF EXISTS contract_state_coverage`.execute(db);
	});
}
