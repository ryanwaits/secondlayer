import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * `webhook_deliveries` gains the delivered event's `tx_id`, `block_height`,
 * `block_time` and `event_index`, copied from the outbox row at dispatch.
 *
 * The list read used to join `webhook_outbox` for them, but delivered outbox
 * rows are pruned after 7 days while deliveries live 30, so attempts 7–30
 * days old lost their tx and height. Owning the columns also lets the list
 * filter by tx and height. Rows already logged are backfilled from any
 * outbox row still present; deliveries tables are small (attempts expire
 * after 30 days), so the backfill runs inline.
 *
 * `webhook_deliveries_tx_idx` serves `?tx_id=`; height ranges ride
 * `deliveries_sub_idx (webhook_id, dispatched_at)` under the webhook filter.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`SET LOCAL statement_timeout = 0`.execute(db);
		await sql`
			ALTER TABLE webhook_deliveries
				ADD COLUMN IF NOT EXISTS tx_id text,
				ADD COLUMN IF NOT EXISTS block_height bigint,
				ADD COLUMN IF NOT EXISTS block_time timestamptz,
				ADD COLUMN IF NOT EXISTS event_index integer
		`.execute(db);
		await sql`
			UPDATE webhook_deliveries d
			SET tx_id = o.tx_id,
				block_height = o.block_height,
				block_time = o.block_time,
				event_index = CASE
					WHEN jsonb_typeof(o.row_pk -> 'event_index') = 'number'
					THEN (o.row_pk ->> 'event_index')::integer
				END
			FROM webhook_outbox o
			WHERE o.id = d.outbox_id AND d.tx_id IS NULL AND d.block_height IS NULL
		`.execute(db);
		await sql`
			CREATE INDEX IF NOT EXISTS webhook_deliveries_tx_idx
			ON webhook_deliveries (webhook_id, tx_id)
			WHERE tx_id IS NOT NULL
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`DROP INDEX IF EXISTS webhook_deliveries_tx_idx`.execute(db);
		await sql`
			ALTER TABLE webhook_deliveries
				DROP COLUMN IF EXISTS tx_id,
				DROP COLUMN IF EXISTS block_height,
				DROP COLUMN IF EXISTS block_time,
				DROP COLUMN IF EXISTS event_index
		`.execute(db);
	});
}
