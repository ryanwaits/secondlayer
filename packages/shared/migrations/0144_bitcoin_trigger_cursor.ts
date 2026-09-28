import type { Kysely } from "kysely";
import { sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Cursor for the Bitcoin (Runes) chain-trigger evaluator (plan 060 / control
 * plane / TARGET). A Streams cursor `<block_height>:<event_index>` over
 * `chain=bitcoin` events (plan 059) — a separate clock from `last_processed_block`
 * (Stacks), since Bitcoin block heights are unrelated to Stacks ones. Null =
 * uninitialized → the evaluator fast-forwards to the Bitcoin Streams tip and
 * emits nothing (forward-only, no historical backfill), mirroring the Stacks
 * cursor and `last_settlement_scan_at` (0105). Follows 0105's ALTER style.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE trigger_evaluator_state
			ADD COLUMN IF NOT EXISTS bitcoin_last_cursor TEXT
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE trigger_evaluator_state
			DROP COLUMN IF EXISTS bitcoin_last_cursor
		`.execute(db);
	});
}
