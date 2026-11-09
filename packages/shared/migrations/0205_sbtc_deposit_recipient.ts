import { type Kysely, sql } from "kysely";
import { onChainPlane, onControlPlane } from "../src/db/migration-role.ts";

// `completed-deposit` prints carry no recipient, so deposits had no Stacks
// address. The recipient is the sBTC mint one event earlier in the same tx with
// the same amount (true for all 67,653 mainnet deposits at writing); the
// decoder now writes it to a new `recipient` column. `sender` stays for
// withdrawals, where it is the real sender.
//
// Chain plane: add the column, fill history from the decoded mints (~70k rows).
// Control plane: `sbtc_deposit` triggers filter on `recipient` instead of
// `sender`, and drop `requestId` (deposits have none). Each step is skipped
// when its table is absent.
async function tableExists(db: Kysely<unknown>, table: string) {
	const { rows } = await sql<{ exists: boolean }>`
		SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS exists
	`.execute(db);
	return rows[0]?.exists === true;
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onChainPlane(async () => {
		if (!(await tableExists(db, "sbtc_events"))) return;
		await sql`ALTER TABLE sbtc_events ADD COLUMN IF NOT EXISTS recipient TEXT`.execute(
			db,
		);
		await sql`
			UPDATE sbtc_events e
			SET recipient = t.recipient
			FROM sbtc_token_events t
			WHERE e.topic = 'completed-deposit'
				AND e.recipient IS NULL
				AND t.event_type = 'mint'
				AND t.tx_id = e.tx_id
				AND t.block_height = e.block_height
				AND t.event_index = e.event_index - 1
				AND t.amount = e.amount
		`.execute(db);
		await sql`CREATE INDEX IF NOT EXISTS sbtc_events_recipient_height_idx ON sbtc_events (recipient, block_height) WHERE recipient IS NOT NULL`.execute(
			db,
		);
	});
	await onControlPlane(async () => {
		if (!(await tableExists(db, "webhooks"))) return;
		await sql`
			UPDATE webhooks
			SET triggers = (
				SELECT jsonb_agg(
					CASE WHEN t->>'type' = 'sbtc_deposit'
						THEN (t - 'sender' - 'requestId')
							|| CASE WHEN t ? 'sender'
								THEN jsonb_build_object('recipient', t->'sender')
								ELSE '{}'::jsonb END
						ELSE t END
					ORDER BY ord)
				FROM jsonb_array_elements(triggers) WITH ORDINALITY AS a(t, ord)
			)
			WHERE jsonb_typeof(triggers) = 'array'
				AND triggers @> '[{"type":"sbtc_deposit"}]'
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		if (!(await tableExists(db, "sbtc_events"))) return;
		await sql`DROP INDEX IF EXISTS sbtc_events_recipient_height_idx`.execute(
			db,
		);
		await sql`ALTER TABLE sbtc_events DROP COLUMN IF EXISTS recipient`.execute(
			db,
		);
	});
}
