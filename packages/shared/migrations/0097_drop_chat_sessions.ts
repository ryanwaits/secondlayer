import { sql } from "kysely";
import type { Kysely } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Drop the hosted chat-session store (Sessions feature removed — users bring
 * their own agent harness via MCP/skills/prompts; nothing persists chat
 * server-side anymore). `chat_messages` goes first (FK → chat_sessions).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS chat_messages`.execute(db);
		await sql`DROP TABLE IF EXISTS chat_sessions`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE chat_sessions (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				title TEXT,
				summary TEXT,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`.execute(db);
		await sql`
			CREATE INDEX chat_sessions_account_idx
			ON chat_sessions (account_id, created_at DESC)
		`.execute(db);
		await sql`
			CREATE TABLE chat_messages (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				chat_session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
				role VARCHAR(20) NOT NULL,
				parts JSONB NOT NULL,
				metadata JSONB,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`.execute(db);
		await sql`
			CREATE INDEX chat_messages_session_idx
			ON chat_messages (chat_session_id, created_at)
		`.execute(db);
	});
}
