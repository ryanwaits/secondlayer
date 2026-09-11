import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Recreate claim_tokens (dropped in 0118) for accountless play, plus
 * play_provisions for the 3-per-IP-per-UTC-day cap. Control plane only.
 * Copy of 0093's claim_tokens shape: hashed one-shot tokens that attach a
 * ghost account to an email at claim time.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE claim_tokens (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				token_hash TEXT NOT NULL UNIQUE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				expires_at TIMESTAMPTZ NOT NULL,
				used_at TIMESTAMPTZ
			)
		`.execute(db);
		await sql`CREATE INDEX claim_tokens_account_id_idx ON claim_tokens (account_id)`.execute(
			db,
		);
		await sql`
			CREATE TABLE play_provisions (
				ip_hash TEXT NOT NULL,
				day DATE NOT NULL,
				count INTEGER NOT NULL DEFAULT 1,
				PRIMARY KEY (ip_hash, day)
			)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS play_provisions`.execute(db);
		await sql`DROP TABLE IF EXISTS claim_tokens`.execute(db);
	});
}
