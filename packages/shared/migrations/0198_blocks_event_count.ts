import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

// The event count `persistBlock` was handed for a height, set at write time.
// Sibling of `tx_count` (0143): lets a check compare `count(events at h)`
// against what the block was supposed to hold, catching an insert that
// silently skipped rows (a conflict-ignored duplicate, a dropped chunk).
// Nullable, no default: catalog-only on a table this size, and historical rows
// have no baseline. `blocks` is a chain-plane table, so the DDL no-ops on the
// control DB under the source/target split.
export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`ALTER TABLE blocks ADD COLUMN IF NOT EXISTS event_count INT`.execute(
			db,
		);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`ALTER TABLE blocks DROP COLUMN IF EXISTS event_count`.execute(db);
	});
}
