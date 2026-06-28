import type { Kysely } from "kysely";
import { sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Scan cursor for the sBTC settlement-confirmed webhook (control plane / TARGET).
 *
 * The settlement confirmer flips `sbtc_settlements.settlement_confirmed` on a
 * Bitcoin confirmation — asynchronous to Stacks blocks, so the per-block
 * `last_processed_block` cursor can't drive its webhook. The evaluator scans for
 * `confirmed_at > last_settlement_scan_at` each tick and advances this watermark.
 * Null = uninitialized → the evaluator fast-forwards it to now() and emits
 * nothing (forward-only, no historical backfill), mirroring the block cursor.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE trigger_evaluator_state
			ADD COLUMN IF NOT EXISTS last_settlement_scan_at TIMESTAMPTZ
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE trigger_evaluator_state
			DROP COLUMN IF EXISTS last_settlement_scan_at
		`.execute(db);
	});
}
