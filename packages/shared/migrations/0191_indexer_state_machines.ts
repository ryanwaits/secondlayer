import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

/**
 * Indexer state machines.
 *
 * - `observer_journal.status` gains `poisoned` (deterministic apply failure,
 *   skipped after N tries) and `skipped` (receipt deliberately never applied:
 *   a refused bootstrap spool, a superseded burn block). Mirrors
 *   `OBSERVER_JOURNAL_STATUSES` (db/types.ts).
 * - `contracts` gains `abi_attempts` / `abi_next_attempt_at` so `failed` is a
 *   retryable state with backoff instead of a terminal one. Every existing
 *   `failed` row re-polls once (attempts = 1, due now); the registry's poll
 *   batch size bounds how fast.
 *
 * Skipped where the tables are absent (not every database carries them).
 */

const JOURNAL_STATUSES_OLD =
	"status IN ('received', 'processed', 'failed', 'retried')";
const JOURNAL_STATUSES_NEW =
	"status IN ('received', 'processed', 'failed', 'retried', 'poisoned', 'skipped')";

async function tableExists(db: Kysely<unknown>, table: string) {
	const { rows } = await sql<{ exists: boolean }>`
		SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS exists
	`.execute(db);
	return rows[0]?.exists === true;
}

async function replaceJournalCheck(db: Kysely<unknown>, expression: string) {
	await sql`ALTER TABLE observer_journal DROP CONSTRAINT IF EXISTS observer_journal_status_check`.execute(
		db,
	);
	await sql`
		ALTER TABLE observer_journal
			ADD CONSTRAINT observer_journal_status_check CHECK (${sql.raw(expression)}) NOT VALID
	`.execute(db);
	await sql`ALTER TABLE observer_journal VALIDATE CONSTRAINT observer_journal_status_check`.execute(
		db,
	);
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onChainPlane(async () => {
		if (await tableExists(db, "observer_journal")) {
			await replaceJournalCheck(db, JOURNAL_STATUSES_NEW);
		}
		if (await tableExists(db, "contracts")) {
			await sql`
				ALTER TABLE contracts
					ADD COLUMN IF NOT EXISTS abi_attempts integer NOT NULL DEFAULT 0,
					ADD COLUMN IF NOT EXISTS abi_next_attempt_at timestamptz
			`.execute(db);
			await sql`
				UPDATE contracts
				   SET abi_attempts = 1, abi_next_attempt_at = now()
				 WHERE abi_status = 'failed'
			`.execute(db);
		}
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onChainPlane(async () => {
		if (await tableExists(db, "observer_journal")) {
			await sql`
				UPDATE observer_journal SET status = 'failed'
				 WHERE status IN ('poisoned', 'skipped')
			`.execute(db);
			await replaceJournalCheck(db, JOURNAL_STATUSES_OLD);
		}
		if (await tableExists(db, "contracts")) {
			await sql`
				ALTER TABLE contracts
					DROP COLUMN IF EXISTS abi_attempts,
					DROP COLUMN IF EXISTS abi_next_attempt_at
			`.execute(db);
		}
	});
}
