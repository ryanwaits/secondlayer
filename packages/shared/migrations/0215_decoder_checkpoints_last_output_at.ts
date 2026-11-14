import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

// Decoder health now reads `decoder_checkpoints.last_output_at`, stamped in the
// commit transaction when a commit wrote rows. The composite index only served
// the old per-table "latest created_at" health query (see 0080), and cost a
// write on every decoded row. Chain-plane only; no-ops when a table is absent.
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onChainPlane(async () => {
		// Nullable, no default: metadata-only change.
		await sql`ALTER TABLE IF EXISTS decoder_checkpoints ADD COLUMN IF NOT EXISTS last_output_at TIMESTAMPTZ`.execute(
			db,
		);
		await sql`DROP INDEX IF EXISTS decoded_events_evt_canon_created_idx`.execute(
			db,
		);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onChainPlane(async () => {
		await sql`ALTER TABLE IF EXISTS decoder_checkpoints DROP COLUMN IF EXISTS last_output_at`.execute(
			db,
		);
		await sql`DO $$ BEGIN
			IF to_regclass('public.decoded_events') IS NOT NULL THEN
				CREATE INDEX IF NOT EXISTS decoded_events_evt_canon_created_idx ON decoded_events (event_type, canonical, created_at DESC);
			END IF;
		END $$`.execute(db);
	});
}
