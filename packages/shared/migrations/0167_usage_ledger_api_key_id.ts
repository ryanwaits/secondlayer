import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * `usage_ledger.api_key_id` — the API key behind a metered read, so usage
 * can be shown per key. `NULL` for session callers, first-party internal
 * keys, every non-read unit (webhooks, memory, archive) and every row
 * written before this column existed.
 *
 * Deliberately no foreign key: the ledger is an append-only billing audit
 * and must never fail or lock a write over key bookkeeping. Keys are only
 * revoked (status flip), never deleted, so ids stay resolvable. Nullable
 * with no default, so Postgres adds it without rewriting the table; the
 * existing (account_id, occurred_at) index already serves per-key queries.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`ALTER TABLE usage_ledger ADD COLUMN api_key_id uuid`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`ALTER TABLE usage_ledger DROP COLUMN IF EXISTS api_key_id`.execute(
			db,
		);
	});
}
