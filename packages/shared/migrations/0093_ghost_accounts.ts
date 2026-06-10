import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

// Ghost accounts: anonymous self-serve API keys. `POST /v1/keys` with no auth
// mints an account with ghost=true and email NULL; a claim token (hash stored,
// raw returned once in the claim URL) later attaches an email via the magic-link
// flow. Email's NOT NULL is dropped; the existing plain UNIQUE constraint stays —
// Postgres unique constraints ignore NULLs (multiple NULL emails coexist), so
// `ON CONFLICT (email)` upserts keep working unchanged and no partial index is
// needed. Control-plane (TARGET).
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE accounts
			ADD COLUMN ghost BOOLEAN NOT NULL DEFAULT false
		`.execute(db);
		await sql`ALTER TABLE accounts ALTER COLUMN email DROP NOT NULL`.execute(
			db,
		);
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
		// Sweeper + claim flow look tokens up by account.
		await sql`CREATE INDEX claim_tokens_account_id_idx ON claim_tokens (account_id)`.execute(
			db,
		);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS claim_tokens`.execute(db);
		// Unclaimed ghosts have NULL emails — they cannot survive a NOT NULL
		// restore, so drop them before reinstating the constraint.
		await sql`DELETE FROM accounts WHERE email IS NULL`.execute(db);
		await sql`ALTER TABLE accounts ALTER COLUMN email SET NOT NULL`.execute(db);
		await sql`ALTER TABLE accounts DROP COLUMN IF EXISTS ghost`.execute(db);
	});
}
