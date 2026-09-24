import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Drop the hosted subgraph tables: accountless play (claim_tokens,
 * play_provisions, from 0125) and the hosted meter ledger (hosted_meter_days,
 * from 0124). Hosted subgraphs are not offered; subgraphs and webhooks run on
 * self-host only. Prod 2026-09-23: count(*) = 0 on all three.
 *
 * `down` recreates the empty tables exactly as 0124/0125 created them.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS hosted_meter_days`.execute(db);
		await sql`DROP TABLE IF EXISTS play_provisions`.execute(db);
		await sql`DROP TABLE IF EXISTS claim_tokens`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE IF NOT EXISTS claim_tokens (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				token_hash TEXT NOT NULL UNIQUE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				expires_at TIMESTAMPTZ NOT NULL,
				used_at TIMESTAMPTZ
			)
		`.execute(db);
		await sql`CREATE INDEX IF NOT EXISTS claim_tokens_account_id_idx ON claim_tokens (account_id)`.execute(
			db,
		);
		await sql`
			CREATE TABLE IF NOT EXISTS play_provisions (
				ip_hash TEXT NOT NULL,
				day DATE NOT NULL,
				count INTEGER NOT NULL DEFAULT 1,
				PRIMARY KEY (ip_hash, day)
			)
		`.execute(db);
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
