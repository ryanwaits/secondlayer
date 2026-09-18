import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

/**
 * `vm_events` referenced `transactions` / `blocks` with plain FKs, like
 * `events_tx_id_fkey`. Every sweep that deletes a height (cli bootstrap and
 * repair, repair-fork-block, cleanup-reorg-dupes, the smoke and drill scripts)
 * deletes `events` explicitly before `transactions` — and none of them name
 * `vm_events`, so each would fail with an FK violation the moment a vm row
 * exists. Cascade instead of teaching six call sites about a second child:
 * vm rows follow their parent. persistBlock still archives + deletes them
 * explicitly before the parent, which stays correct under cascade.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`
			ALTER TABLE vm_events
				DROP CONSTRAINT IF EXISTS vm_events_tx_id_fkey,
				DROP CONSTRAINT IF EXISTS vm_events_block_height_fkey
		`.execute(db);
		await sql`
			ALTER TABLE vm_events
				ADD CONSTRAINT vm_events_tx_id_fkey
					FOREIGN KEY (tx_id) REFERENCES transactions (tx_id) ON DELETE CASCADE,
				ADD CONSTRAINT vm_events_block_height_fkey
					FOREIGN KEY (block_height) REFERENCES blocks (height) ON DELETE CASCADE
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`
			ALTER TABLE vm_events
				DROP CONSTRAINT IF EXISTS vm_events_tx_id_fkey,
				DROP CONSTRAINT IF EXISTS vm_events_block_height_fkey
		`.execute(db);
		await sql`
			ALTER TABLE vm_events
				ADD CONSTRAINT vm_events_tx_id_fkey
					FOREIGN KEY (tx_id) REFERENCES transactions (tx_id),
				ADD CONSTRAINT vm_events_block_height_fkey
					FOREIGN KEY (block_height) REFERENCES blocks (height)
		`.execute(db);
	});
}
