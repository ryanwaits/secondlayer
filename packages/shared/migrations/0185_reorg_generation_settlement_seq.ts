import { type Kysely, sql } from "kysely";
import { onChainPlane, onControlPlane } from "../src/db/migration-role.ts";

/**
 * Two cursor fixes for chain webhooks.
 *
 * Control plane / TARGET, `trigger_evaluator_state`:
 *  - `reorg_generation` counts reorg rewinds. The evaluator reads it before it
 *    loads a batch and re-checks it, under the row lock, in the transaction that
 *    inserts the batch's outbox rows and advances the cursor, so a reorg that
 *    lands in between rolls the batch back instead of emitting orphan-fork rows.
 *  - `last_settlement_scan_seq` is the sBTC settlement watermark. Null until the
 *    first settlement row is scanned; `last_settlement_scan_at` stays as the
 *    forward-only floor until then.
 *
 * Chain plane / SOURCE, `sbtc_settlements.seq`: a monotonic stamp taken from a
 * sequence each time a sweep becomes confirmed. `confirmed_at` mixes the writer's
 * JS clock (insert) with SQL `now()` (update), so commit order did not match
 * timestamp order and a watermark on it skipped rows for good. Existing rows are
 * numbered in `confirmed_at` order so the watermark keeps its meaning.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE trigger_evaluator_state
				ADD COLUMN IF NOT EXISTS reorg_generation bigint NOT NULL DEFAULT 0,
				ADD COLUMN IF NOT EXISTS last_settlement_scan_seq bigint
		`.execute(db);
	});

	await onChainPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`
			DO $$
			BEGIN
				IF to_regclass('sbtc_settlements') IS NULL THEN
					RETURN;
				END IF;
				CREATE SEQUENCE IF NOT EXISTS sbtc_settlements_seq;
				ALTER TABLE sbtc_settlements ADD COLUMN IF NOT EXISTS seq bigint;
				UPDATE sbtc_settlements s
					SET seq = n.rn
					FROM (
						SELECT sweep_txid,
							row_number() OVER (
								ORDER BY confirmed_at NULLS FIRST, first_seen_at, sweep_txid
							) AS rn
						FROM sbtc_settlements
						WHERE seq IS NULL
					) n
					WHERE s.sweep_txid = n.sweep_txid;
				PERFORM setval(
					'sbtc_settlements_seq',
					GREATEST(COALESCE((SELECT max(seq) FROM sbtc_settlements), 0), 1),
					(SELECT max(seq) FROM sbtc_settlements) IS NOT NULL
				);
				ALTER TABLE sbtc_settlements
					ALTER COLUMN seq SET DEFAULT nextval('sbtc_settlements_seq'),
					ALTER COLUMN seq SET NOT NULL;
				CREATE INDEX IF NOT EXISTS sbtc_settlements_seq_idx
					ON sbtc_settlements (seq);
			END
			$$
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`DROP INDEX IF EXISTS sbtc_settlements_seq_idx`.execute(db);
		await sql`
			DO $$
			BEGIN
				IF to_regclass('sbtc_settlements') IS NOT NULL THEN
					ALTER TABLE sbtc_settlements DROP COLUMN IF EXISTS seq;
				END IF;
			END
			$$
		`.execute(db);
		await sql`DROP SEQUENCE IF EXISTS sbtc_settlements_seq`.execute(db);
	});
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE trigger_evaluator_state
				DROP COLUMN IF EXISTS last_settlement_scan_seq,
				DROP COLUMN IF EXISTS reorg_generation
		`.execute(db);
	});
}
