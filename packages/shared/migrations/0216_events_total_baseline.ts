import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

// One row: the canonical-events count through a finalized height, shared by
// every API process so a new process extends it instead of recounting all of
// `events`. `claimed_at` marks the one process running a full recount.
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onChainPlane(async () => {
		await sql`
			CREATE TABLE IF NOT EXISTS events_total_baseline (
				id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
				through BIGINT,
				count BIGINT,
				taken_at TIMESTAMPTZ,
				claimed_at TIMESTAMPTZ
			)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`DROP TABLE IF EXISTS events_total_baseline`.execute(db);
	});
}
