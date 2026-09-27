import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

// The tx count `persistBlock` was actually handed for a height, set at write
// time from the incoming block. Nullable: historical rows backfill lazily /
// on demand. Lets a completeness check compare `count(transactions at h)`
// against what the block was supposed to hold, catching a persist that
// silently landed fewer rows than it received — see the ingest transaction
// completeness plan. `blocks` is a chain-plane table, so the DDL no-ops on
// the control DB under the source/target split.
export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`ALTER TABLE blocks ADD COLUMN IF NOT EXISTS tx_count INT`.execute(
			db,
		);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`ALTER TABLE blocks DROP COLUMN IF EXISTS tx_count`.execute(db);
	});
}
