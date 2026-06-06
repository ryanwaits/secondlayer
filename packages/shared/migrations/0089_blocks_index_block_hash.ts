import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

// Persist the Nakamoto `index_block_hash` (StacksBlockId) on `blocks`. It
// already arrives in the node's /new_block payload but was dropped at insert;
// keeping it lets the tx-inclusion proof endpoint resolve a block's signed
// header from /v3/blocks without an extra node round-trip per request. Nullable:
// historical rows backfill lazily / on demand. `blocks` is a chain-plane table,
// so the DDL no-ops on the control DB under the source/target split.
export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`ALTER TABLE blocks ADD COLUMN IF NOT EXISTS index_block_hash TEXT`.execute(
			db,
		);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`ALTER TABLE blocks DROP COLUMN IF EXISTS index_block_hash`.execute(
			db,
		);
	});
}
