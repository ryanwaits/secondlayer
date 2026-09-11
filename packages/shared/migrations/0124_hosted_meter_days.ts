import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Daily idempotency ledger for hosted subgraph running + storage meters.
 * Control plane only. One row per (day, account, subgraph, kind) so the
 * worker can INSERT ON CONFLICT DO NOTHING and debit only on first insert.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE IF NOT EXISTS hosted_meter_days (
				day            date NOT NULL,
				account_id     text NOT NULL,
				subgraph_name  text NOT NULL,
				kind           text NOT NULL,
				usd_micros     bigint NOT NULL,
				billed_at      timestamptz NOT NULL DEFAULT now(),
				PRIMARY KEY (day, account_id, subgraph_name, kind),
				CHECK (kind IN ('running', 'storage'))
			)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS hosted_meter_days`.execute(db);
	});
}
