import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * OAuth for the hosted MCP endpoint (`<api>/mcp`). An app registers itself
 * (`oauth_clients`, public clients only), sends the person to authorize
 * (`oauth_requests`, answered on the web consent page), swaps the one-time
 * code (`oauth_codes`) for tokens, and holds a grant (`oauth_grants`) with one
 * live refresh token and short-lived access tokens (`oauth_tokens`). A rotated
 * refresh token is remembered in `oauth_refresh_retired` so a replay revokes
 * the grant. Every code and token is stored as its SHA-256 hash only.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE oauth_clients (
				id            text PRIMARY KEY,
				name          text NOT NULL,
				redirect_uris text[] NOT NULL,
				created_ip    text,
				created_at    timestamptz NOT NULL DEFAULT now(),
				last_used_at  timestamptz
			)
		`.execute(db);
		await sql`
			CREATE INDEX oauth_clients_unused
				ON oauth_clients (created_at) WHERE last_used_at IS NULL
		`.execute(db);

		await sql`
			CREATE TABLE oauth_requests (
				id             text PRIMARY KEY,
				client_id      text NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
				redirect_uri   text NOT NULL,
				state          text,
				code_challenge text NOT NULL,
				resource       text NOT NULL,
				status         text NOT NULL DEFAULT 'pending'
					CHECK (status IN ('pending', 'approved', 'denied')),
				account_id     uuid REFERENCES accounts(id) ON DELETE CASCADE,
				created_at     timestamptz NOT NULL DEFAULT now(),
				expires_at     timestamptz NOT NULL,
				answered_at    timestamptz
			)
		`.execute(db);
		await sql`
			CREATE INDEX oauth_requests_expires ON oauth_requests (expires_at)
		`.execute(db);

		await sql`
			CREATE TABLE oauth_grants (
				id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				client_id    text NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
				scope        text NOT NULL DEFAULT 'mcp',
				resource     text NOT NULL,
				created_at   timestamptz NOT NULL DEFAULT now(),
				last_used_at timestamptz,
				revoked_at   timestamptz
			)
		`.execute(db);
		await sql`
			CREATE INDEX oauth_grants_account ON oauth_grants (account_id)
		`.execute(db);

		await sql`
			CREATE TABLE oauth_codes (
				code_hash      text PRIMARY KEY,
				client_id      text NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
				account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				redirect_uri   text NOT NULL,
				code_challenge text NOT NULL,
				resource       text NOT NULL,
				grant_id       uuid REFERENCES oauth_grants(id) ON DELETE SET NULL,
				created_at     timestamptz NOT NULL DEFAULT now(),
				expires_at     timestamptz NOT NULL,
				used_at        timestamptz
			)
		`.execute(db);
		await sql`
			CREATE INDEX oauth_codes_expires ON oauth_codes (expires_at)
		`.execute(db);

		await sql`
			CREATE TABLE oauth_tokens (
				token_hash text PRIMARY KEY,
				grant_id   uuid NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
				kind       text NOT NULL CHECK (kind IN ('access', 'refresh')),
				created_at timestamptz NOT NULL DEFAULT now(),
				expires_at timestamptz NOT NULL
			)
		`.execute(db);
		await sql`
			CREATE INDEX oauth_tokens_grant ON oauth_tokens (grant_id)
		`.execute(db);
		await sql`
			CREATE INDEX oauth_tokens_expires ON oauth_tokens (expires_at)
		`.execute(db);

		await sql`
			CREATE TABLE oauth_refresh_retired (
				token_hash text PRIMARY KEY,
				grant_id   uuid NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
				retired_at timestamptz NOT NULL DEFAULT now()
			)
		`.execute(db);
		await sql`
			CREATE INDEX oauth_refresh_retired_at ON oauth_refresh_retired (retired_at)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS oauth_refresh_retired`.execute(db);
		await sql`DROP TABLE IF EXISTS oauth_tokens`.execute(db);
		await sql`DROP TABLE IF EXISTS oauth_codes`.execute(db);
		await sql`DROP TABLE IF EXISTS oauth_grants`.execute(db);
		await sql`DROP TABLE IF EXISTS oauth_requests`.execute(db);
		await sql`DROP TABLE IF EXISTS oauth_clients`.execute(db);
	});
}
